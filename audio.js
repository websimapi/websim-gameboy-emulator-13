// audio.js - Audio Processing Unit and sound channels implementation

import { APURegisters } from './constants.js';

// Audio Processing unit
// Handles sound generation and emulates the GameBoy sound hardware
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
            this.masterGain.gain.value = 0.05; // Lower overall volume to reduce distortion
            
            // Create a lowpass filter to reduce high-frequency noise
            this.lowpass = this.audioContext.createBiquadFilter();
            this.lowpass.type = 'lowpass';
            this.lowpass.frequency.value = 10000; // Reduce high frequencies
            this.lowpass.Q.value = 0.5; // Lower resonance for smoother sound
            
            // Create a highpass filter to reduce low-frequency rumble
            this.highpass = this.audioContext.createBiquadFilter();
            this.highpass.type = 'highpass';
            this.highpass.frequency.value = 80; // Filter out very low frequencies
            this.highpass.Q.value = 0.5; // Lower resonance for smoother sound
            
            // Connect filter chain to destination
            this.lowpass.connect(this.highpass);
            this.highpass.connect(this.masterGain);
            this.masterGain.connect(this.audioContext.destination);
            
            // Create a compressor to prevent audio clipping and reduce peaks
            this.compressor = this.audioContext.createDynamicsCompressor();
            this.compressor.threshold.value = -20; // Lower threshold to catch more peaks
            this.compressor.knee.value = 25; // Smoother compression curve
            this.compressor.ratio.value = 10; // Less aggressive ratio
            this.compressor.attack.value = 0.005; // Slightly slower attack to preserve transients
            this.compressor.release.value = 0.15; // Faster release time for more natural sound
            this.compressor.connect(this.lowpass);
            
            // Create channels
            this.channel1 = new Channel1(this, 1, this.audioContext, this.compressor);
            this.channel2 = new Channel1(this, 2, this.audioContext, this.compressor);
            this.channel3 = new Channel3(this, 3, this.audioContext, this.compressor);
            this.channel4 = new Channel4(this, 4, this.audioContext, this.compressor);
            
            // Initialize update counters - GameBoy sound timer runs at 512Hz
            this.updateCounter = 0;
            this.updateFrequency = 87; // ~512Hz when running at 4MHz GameBoy clock
            
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
                console.log('Audio context resumed successfully');
                this.audioContextStarted = true;
                this.enableChannels();
            }).catch(err => {
                console.error('Failed to resume audio context:', err);
            });
        } else {
            this.audioContextStarted = true;
            this.enableChannels();
        }
        
        this.enabled = true;
    }
    
    enableChannels() {
        // Enable all channels if they were previously created
        if (this.channel1) this.channel1.enable();
        if (this.channel2) this.channel2.enable();
        if (this.channel3) this.channel3.enable();
        if (this.channel4) this.channel4.enable();
    }

    disconnect() {
        if (!this.audioContext) return;
        
        // Disable all channels
        if (this.channel1) this.channel1.disable();
        if (this.channel2) this.channel2.disable();
        if (this.channel3) this.channel3.disable();
        if (this.channel4) this.channel4.disable();
        
        this.enabled = false;
    }

    // Updates the states of each channel given the elapsed time
    // (in instructions) since last update
    update(clockElapsed) {
        if (!this.enabled || !this.audioContextStarted) return;

        // Accumulate cycles for proper timing
        this.updateCounter += clockElapsed;
        if (this.updateCounter >= this.updateFrequency) {
            // Calculate how many audio frames should be processed
            const framesCount = Math.floor(this.updateCounter / this.updateFrequency);
            const actualElapsed = framesCount * this.updateFrequency;
            this.updateCounter -= actualElapsed;

            try {
                // Update each channel with the accumulated clock cycles
                if (this.channel1) this.channel1.update(actualElapsed);
                if (this.channel2) this.channel2.update(actualElapsed);
                if (this.channel3) this.channel3.update(actualElapsed);
                if (this.channel4) this.channel4.update(actualElapsed);
            } catch (e) {
                console.error("Audio update error:", e);
            }
        }
    }

    setSoundFlag(channel, value) {
        if (!this.memory) return;
        
        var mask = 0xFF - (1 << (channel - 1));
        value = value << (channel - 1);
        var byteValue = this.memory.rb(APURegisters.NR52);
        byteValue &= mask;
        byteValue |= value;
        this.memory[APURegisters.NR52] = byteValue;
    }

    // Manage writes to audio registers
    manageWrite(addr, value) {
        if (this.enabled == false && addr < APURegisters.NR52) {
            return;
        }
        this.memory[addr] = value;

        try {
            switch (addr) {
                // Channel 1 addresses
                case APURegisters.NR10:
                    if (this.channel1) {
                        this.channel1.clockSweep = 0;
                        this.channel1.sweepTime = ((value & 0x70) >> 4);
                        this.channel1.sweepSign = (value & 0x08) ? -1 : 1;
                        this.channel1.sweepShifts = (value & 0x07);
                        this.channel1.sweepCount = this.channel1.sweepShifts;
                    }
                    break;
                case APURegisters.NR11:
                    if (this.channel1) {
                        // Bits 6-7 for wave duty (square wave)
                        this.channel1.dutyCycle = (value & 0xC0) >> 6;
                        this.channel1.setLength(value & 0x3F);
                    }
                    break;
                case APURegisters.NR12:
                    if (this.channel1) {
                        this.channel1.envelopeSign = (value & 0x08) ? 1 : -1;
                        var envelopeVolume = (value & 0xF0) >> 4;
                        this.channel1.setEnvelopeVolume(envelopeVolume);
                        this.channel1.envelopeStep = (value & 0x07);
                        // If volume is 0 and envelope is negative, silence the channel
                        if (envelopeVolume === 0 && this.channel1.envelopeSign === -1) {
                            this.channel1.stop();
                        }
                    }
                    break;
                case APURegisters.NR13:
                    if (this.channel1) {
                        var frequency = this.channel1.getFrequency();
                        frequency &= 0xF00;
                        frequency |= value;
                        this.channel1.setFrequency(frequency);
                    }
                    break;
                case APURegisters.NR14:
                    if (this.channel1) {
                        var frequency = this.channel1.getFrequency();
                        frequency &= 0xFF;
                        frequency |= (value & 7) << 8;
                        this.channel1.setFrequency(frequency);
                        this.channel1.lengthCheck = (value & 0x40) ? true : false;
                        if (value & 0x80) this.channel1.play();
                    }
                    break;

                // Channel 2 addresses
                case APURegisters.NR21:
                    if (this.channel2) {
                        // Bits 6-7 for wave duty (square wave)
                        this.channel2.dutyCycle = (value & 0xC0) >> 6;
                        this.channel2.setLength(value & 0x3F);
                    }
                    break;
                case APURegisters.NR22:
                    if (this.channel2) {
                        this.channel2.envelopeSign = (value & 0x08) ? 1 : -1;
                        var envelopeVolume = (value & 0xF0) >> 4;
                        this.channel2.setEnvelopeVolume(envelopeVolume);
                        this.channel2.envelopeStep = (value & 0x07);
                        // If volume is 0 and envelope is negative, silence the channel
                        if (envelopeVolume === 0 && this.channel2.envelopeSign === -1) {
                            this.channel2.stop();
                        }
                    }
                    break;
                case APURegisters.NR23:
                    if (this.channel2) {
                        var frequency = this.channel2.getFrequency();
                        frequency &= 0xF00;
                        frequency |= value;
                        this.channel2.setFrequency(frequency);
                    }
                    break;
                case APURegisters.NR24:
                    if (this.channel2) {
                        var frequency = this.channel2.getFrequency();
                        frequency &= 0xFF;
                        frequency |= (value & 7) << 8;
                        this.channel2.setFrequency(frequency);
                        this.channel2.lengthCheck = (value & 0x40) ? true : false;
                        if (value & 0x80) {
                            this.channel2.play();
                        }
                    }
                    break;

                // Channel 3 addresses
                case APURegisters.NR30:
                    if (this.channel3) {
                        // Enable/disable wave channel
                        this.channel3.enabled = (value & 0x80) ? true : false;
                        if (!this.channel3.enabled) {
                            this.channel3.stop();
                        }
                    }
                    break;
                case APURegisters.NR31:
                    if (this.channel3) {
                        this.channel3.setLength(value);
                    }
                    break;
                case APURegisters.NR32:
                    if (this.channel3) {
                        // Output level
                        this.channel3.volumeCode = (value & 0x60) >> 5;
                        this.channel3.updateVolume();
                    }
                    break;
                case APURegisters.NR33:
                    if (this.channel3) {
                        var frequency = this.channel3.getFrequency();
                        frequency &= 0xF00;
                        frequency |= value;
                        this.channel3.setFrequency(frequency);
                    }
                    break;
                case APURegisters.NR34:
                    if (this.channel3) {
                        var frequency = this.channel3.getFrequency();
                        frequency &= 0xFF;
                        frequency |= (value & 7) << 8;
                        this.channel3.setFrequency(frequency);
                        this.channel3.lengthCheck = (value & 0x40) ? true : false;
                        if (value & 0x80) {
                            this.channel3.play();
                        }
                    }
                    break;

                // Channel 4 addresses
                case APURegisters.NR41:
                    if (this.channel4) {
                        this.channel4.setLength(value & 0x3F);
                    }
                    break;
                case APURegisters.NR42:
                    if (this.channel4) {
                        // Volume and envelope
                        this.channel4.envelopeSign = (value & 0x08) ? 1 : -1;
                        var envelopeVolume = (value & 0xF0) >> 4;
                        this.channel4.setEnvelopeVolume(envelopeVolume);
                        this.channel4.envelopeStep = (value & 0x07);
                        // If volume is 0 and envelope is negative, silence the channel
                        if (envelopeVolume === 0 && this.channel4.envelopeSign === -1) {
                            this.channel4.stop();
                        }
                    }
                    break;
                case APURegisters.NR43:
                    if (this.channel4) {
                        // Noise parameters
                        this.channel4.shiftFrequency = (value & 0xF0) >> 4;
                        this.channel4.counterStep = (value & 0x08) ? 1 : 0;
                        this.channel4.divRatio = (value & 0x07);
                        this.channel4.updateFrequency();
                    }
                    break;
                case APURegisters.NR44:
                    if (this.channel4) {
                        this.channel4.lengthCheck = (value & 0x40) ? true : false;
                        if (value & 0x80) {
                            this.channel4.play();
                        }
                    }
                    break;

                // channel 3 wave bytes
                case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33:
                case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37:
                case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B:
                case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
                    if (this.channel3) {
                        var index = addr - 0xFF30;
                        this.channel3.setWaveBufferByte(index, value);
                    }
                    break;

                // general audio switch
                case APURegisters.NR52:
                    value &= 0xF0;
                    this.memory[addr] = value;
                    const wasEnabled = this.enabled;
                    this.enabled = (value & 0x80) == 0 ? false : true;
                    
                    if (!this.enabled && wasEnabled) {
                        for (var i = 0xFF10; i < 0xFF27; i++) {
                            this.memory[i] = 0;
                        }
                        this.disconnect();
                    } else if (this.enabled && !wasEnabled) {
                        this.connect();
                    }
                    break;
            }
        } catch (e) {
            console.error("Error in APU.manageWrite:", e);
        }
    }
}

// Channel 1 implementation (square wave with sweep)
export class Channel1 {
    constructor(apu, channelNumber, audioContext, destination) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;
        this.isConnected = false;
        this.dutyCycle = 2; // Default duty (50%)
        this.frameSequencer = 0; // Used for synchronized timing

        // Sound length constants
        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.soundLength = 64; // defaults to 64 periods
        this.lengthCheck = false;

        // Sweep parameters
        this.sweepTime = 0; // from 0 to 7
        this.sweepStepLength = 0x8000; // 1 / 128 seconds of instructions
        this.sweepCount = 0;
        this.sweepShifts = 0;
        this.sweepSign = 1; // +1 / -1 for increase / decrease freq

        this.frequency = 0;

        // Envelope parameters
        this.envelopeStep = 0;
        this.envelopeStepLength = 0x10000;// 1 / 64 seconds of instructions
        this.envelopeCheck = false;
        this.envelopeSign = 1;
        this.envelopeVolume = 0;

        // Clocks for timing
        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;

        // Duty cycle patterns for square wave (accurate to GameBoy hardware)
        this.dutyPatterns = [
            [0, 0, 0, 0, 0, 0, 0, 1], // 12.5%
            [1, 0, 0, 0, 0, 0, 0, 1], // 25%
            [1, 0, 0, 0, 0, 1, 1, 1], // 50%
            [0, 1, 1, 1, 1, 1, 1, 0]  // 75% (inverse 25%)
        ];

        try {
            // Create audio nodes
            this.audioContext = audioContext;
            this.destination = destination;
            
            // Create gain and oscillator nodes
            this.recreateNodes();
        } catch (e) {
            console.error("Error creating Channel1:", e);
        }
    }
    
    recreateNodes() {
        try {
            // Clean up old nodes if they exist
            if (this.oscillator) {
                this.oscillator.disconnect();
                try {
                    this.oscillator.stop();
                } catch (e) {}
            }
            if (this.gainNode) {
                this.gainNode.disconnect();
            }
            
            // Create new nodes
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            // Create filters for more accurate sound
            this.filter = this.audioContext.createBiquadFilter();
            this.filter.type = 'lowpass';
            this.filter.frequency.value = 5000; // More authentic GameBoy sound
            this.filter.Q.value = 0.5; // Lower resonance for smoother sound
            
            // Create oscillator with custom wave
            this.oscillator = this.audioContext.createOscillator();
            this.setupOscillatorType();
            this.oscillator.frequency.value = 440; // A4 note
            
            // Connect with filtering
            this.oscillator.connect(this.filter);
            this.filter.connect(this.gainNode);
            this.gainNode.connect(this.destination);
            
            // Start oscillator
            this.oscillator.start();
            
            this.isConnected = true;
        } catch (e) {
            console.error("Error recreating nodes:", e);
            this.isConnected = false;
        }
    }

    // Create accurate duty cycle waveforms using the GameBoy's 8-step sequence
    setupOscillatorType() {
        try {
            // Get the actual duty cycle pattern
            const pattern = this.dutyPatterns[this.dutyCycle];
            
            // Create a more accurate representation of the GameBoy's square wave
            // by using the actual 8-step sequence the hardware uses
            const real = new Float32Array(9);
            const imag = new Float32Array(9);
            
            // DC offset (first coefficient)
            real[0] = 0;
            imag[0] = 0;
            
            // Calculate Fourier coefficients for the given duty pattern
            for (let n = 1; n < 9; n++) {
                let realSum = 0;
                let imagSum = 0;
                
                for (let k = 0; k < 8; k++) {
                    const angle = -2 * Math.PI * n * k / 8;
                    realSum += pattern[k] * Math.cos(angle);
                    imagSum += pattern[k] * Math.sin(angle);
                }
                
                // Apply a slight rolloff to higher harmonics for smoother sound
                const rolloff = 1.0 / (1.0 + 0.2 * (n - 1));
                real[n] = realSum / 4 * rolloff;  // Dividing by 4 to normalize
                imag[n] = imagSum / 4 * rolloff;
            }
            
            // Create the wave
            const wave = this.audioContext.createPeriodicWave(
                real, imag, 
                {disableNormalization: false}
            );
            
            this.oscillator.setPeriodicWave(wave);
        } catch (e) {
            console.error("Error setting up oscillator type:", e);
            // Fallback to standard square wave if custom wave fails
            this.oscillator.type = 'square';
        }
    }

    play() {
        if (this.playing) return;
        
        // Ensure we have valid audio nodes
        if (!this.isConnected) {
            this.recreateNodes();
            if (!this.isConnected) return;
        }
        
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Apply duty cycle
        this.updateDutyCycle();
        
        // Proper envelope handling requires immediate volume setting
        // then smooth ramping for volume changes
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        
        // Calculate volume based on envelope
        const volume = this.calculateVolume();
        
        // Start with zero volume and ramp up quickly
        this.gainNode.gain.setValueAtTime(0, now);
        this.gainNode.gain.linearRampToValueAtTime(volume, now + 0.002);
        
        // Reset clocks for proper timing
        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;
        
        // Handle initial frequency sweep
        if (this.sweepShifts > 0 && this.sweepTime > 0) {
            this.checkFreqSweep();
        }
    }

    // Calculate actual volume value based on envelope
    calculateVolume() {
        // Scale from 0-15 to a reasonable volume, with quieter output
        // to better match GameBoy hardware and reduce distortion
        return this.envelopeVolume / 180; 
    }

    stop() {
        if (!this.playing || !this.isConnected) return;
        
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        try {
            // Fast but smooth fade out to avoid clicks
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            this.gainNode.gain.linearRampToValueAtTime(0, now + 0.003);
        } catch (e) {
            console.error("Error stopping channel:", e);
        }
    }

    updateDutyCycle() {
        // Update the waveform based on duty cycle
        this.setupOscillatorType();
    }

    checkFreqSweep() {
        var oldFreq = this.getFrequency();
        var newFreq = oldFreq + this.sweepSign * (oldFreq >> this.sweepShifts);
        
        // If frequency goes out of range, stop the channel
        if (newFreq > 0x7FF) {
            newFreq = 0;
            this.stop();
        }

        return newFreq;
    }

    update(clockElapsed) {
        if (!this.playing || !this.isConnected) return;
        
        try {
            // Update clocks
            this.clockEnvelop += clockElapsed;
            this.clockSweep += clockElapsed;

            // Handle frequency sweep - if sweep time and count are valid
            if ((this.sweepCount || this.sweepTime) && 
                this.clockSweep > (this.sweepStepLength * this.sweepTime) && 
                this.sweepTime > 0) {
                
                this.clockSweep -= (this.sweepStepLength * this.sweepTime);
                this.sweepCount--;

                var newFreq = this.checkFreqSweep(); // process and check new freq

                // Update memory registers with the new frequency
                this.apu.memory[0xFF13] = newFreq & 0xFF;
                this.apu.memory[0xFF14] &= 0xF8;
                this.apu.memory[0xFF14] |= (newFreq & 0x700) >> 8;
                
                // Set the new frequency on the oscillator
                this.setFrequency(newFreq);

                // Recheck frequency (required by hardware to catch edge cases)
                this.checkFreqSweep(); 
            }

            // Handle volume envelope - if envelope step is active
            if (this.envelopeCheck && 
                this.clockEnvelop > this.envelopeStepLength && 
                this.envelopeStep > 0) {
                
                this.clockEnvelop -= this.envelopeStepLength;
                this.envelopeStep--;
                
                // Apply envelope by updating volume
                this.setEnvelopeVolume(this.envelopeVolume + this.envelopeSign);
            }

            // Handle length counter - if length check is enabled and we have time left
            if (this.lengthCheck && this.soundLength > 0) {
                this.clockLength += clockElapsed;
                
                if (this.clockLength > this.soundLengthUnit) {
                    this.soundLength--;
                    this.clockLength -= this.soundLengthUnit;
                    
                    // Stop the channel when length reaches zero
                    if (this.soundLength == 0) {
                        this.setLength(0);
                        this.stop();
                    }
                }
            }
        } catch (e) {
            console.error("Error updating channel:", e);
        }
    }

    setFrequency(value) {
        this.frequency = value;
        
        // Clamp frequency to prevent errors
        if (this.frequency < 0) this.frequency = 0;
        if (this.frequency > 2047) this.frequency = 2047;
        
        // GameBoy frequency calculation: 131072/(2048-frequency) Hz
        // This is the correct formula from the hardware specifications
        let realFreq = 131072 / (2048 - this.frequency);
        
        // Clamp to audio range
        realFreq = Math.max(20, Math.min(20000, realFreq));
        
        if (this.oscillator && this.isConnected && 
            !isNaN(realFreq) && isFinite(realFreq)) {
            try {
                // Apply smoother frequency changes
                const now = this.audioContext.currentTime;
                this.oscillator.frequency.cancelScheduledValues(now);
                this.oscillator.frequency.setValueAtTime(this.oscillator.frequency.value, now);
                this.oscillator.frequency.linearRampToValueAtTime(realFreq, now + 0.005);
            } catch (e) {
                console.error("Error setting frequency:", e);
            }
        }
    }

    getFrequency() {
        return this.frequency;
    }

    setLength(value) {
        this.soundLength = 64 - (value & 0x3F);
    }

    setEnvelopeVolume(volume) {
        // Clamp volume to valid range (0-15)
        volume = Math.max(0, Math.min(15, volume));
        
        // Set envelope check flag based on conditions
        this.envelopeCheck = (volume > 0 && volume < 15 && this.envelopeStep > 0);
        this.envelopeVolume = volume;
        
        // Apply volume change to the gain node
        if (this.gainNode && this.isConnected && this.playing) {
            try {
                const now = this.audioContext.currentTime;
                const calculatedVolume = this.calculateVolume();
                
                // Smoother volume transitions (but still fast)
                this.gainNode.gain.cancelScheduledValues(now);
                this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
                this.gainNode.gain.linearRampToValueAtTime(calculatedVolume, now + 0.01);
            } catch (e) {
                console.error("Error setting envelope volume:", e);
            }
        }
    }

    disable() {
        this.stop();
        
        // Clean up resources
        if (this.oscillator) {
            try {
                this.oscillator.disconnect();
                this.oscillator.stop();
            } catch (e) {}
        }
        if (this.filter) {
            try {
                this.filter.disconnect();
            } catch (e) {}
        }
        if (this.gainNode) {
            try {
                this.gainNode.disconnect();
            } catch (e) {}
        }
        
        this.isConnected = false;
    }

    enable() {
        // Recreate nodes if needed
        if (!this.isConnected) {
            this.recreateNodes();
        }
    }
}

// Channel 3 implementation (wave form)
export class Channel3 {
    constructor(apu, channelNumber, audioContext, destination) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;
        this.isConnected = false;
        this.enabled = false;
        this.volumeCode = 0; // 0=mute, 1=100%, 2=50%, 3=25%
        this.needsWaveUpdate = true;
        this.frameSequencer = 0;

        this.soundLength = 0;
        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.lengthCheck = false;

        this.clockLength = 0;
        this.frequency = 0;

        // Create the wave buffer with 32 samples (4 bits per sample, 16 bytes total)
        this.waveBuffer = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
            this.waveBuffer[i] = 0;
        }

        try {
            // Create audio nodes
            this.audioContext = audioContext;
            this.destination = destination;
            
            // Create the audio nodes
            this.recreateNodes();
        } catch (e) {
            console.error("Error creating Channel3:", e);
        }
    }
    
    recreateNodes() {
        try {
            // Clean up old nodes if they exist
            if (this.oscNode) {
                this.oscNode.disconnect();
                try {
                    this.oscNode.stop();
                } catch (e) {}
            }
            if (this.gainNode) {
                this.gainNode.disconnect();
            }
            
            // Create new nodes
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            // Create a filter to smooth the wave
            this.filter = this.audioContext.createBiquadFilter();
            this.filter.type = 'lowpass';
            this.filter.frequency.value = 6000; // Lower for smoother sound
            this.filter.Q.value = 0.5; // Lower resonance = smoother sound
            
            // Create wave oscillator
            this.oscNode = this.audioContext.createOscillator();
            this.oscNode.frequency.value = 440; // A4 note
            
            // Generate custom waveform
            this.updateWaveform();
            
            // Connect nodes
            this.oscNode.connect(this.filter);
            this.filter.connect(this.gainNode);
            this.gainNode.connect(this.destination);
            
            // Start oscillator
            this.oscNode.start();
            
            this.isConnected = true;
        } catch (e) {
            console.error("Error recreating Channel3 nodes:", e);
            this.isConnected = false;
        }
    }

    // Update the oscillator's waveform based on current wave buffer
    updateWaveform() {
        if (!this.isConnected || !this.oscNode) return;
        
        try {
            // Create periodic wave from our 32-sample buffer
            const real = new Float32Array(33);
            const imag = new Float32Array(33);
            
            // DC offset (first coefficient)
            real[0] = 0;
            imag[0] = 0;
            
            // Convert 4-bit samples to normalized values (-1 to 1)
            const normalizedSamples = new Float32Array(32);
            for (let i = 0; i < 32; i++) {
                // Convert 0-15 range to -1 to 1 range, with reduced amplitude
                normalizedSamples[i] = (this.waveBuffer[i] / 7.5) - 1.0;
            }
            
            // Calculate Fourier coefficients (using 16 harmonics for quality)
            for (let n = 1; n < 33; n++) {
                let realSum = 0;
                let imagSum = 0;
                
                for (let k = 0; k < 32; k++) {
                    const angle = -2 * Math.PI * n * k / 32;
                    realSum += normalizedSamples[k] * Math.cos(angle);
                    imagSum += normalizedSamples[k] * Math.sin(angle);
                }
                
                // Apply slight rolloff to higher harmonics for smoother sound
                const rolloff = 1.0 / (1.0 + 0.1 * (n - 1));
                real[n] = realSum / 16 * rolloff;  // Dividing by 16 to normalize
                imag[n] = imagSum / 16 * rolloff;
            }
            
            // Create the wave
            const wave = this.audioContext.createPeriodicWave(
                real, imag, 
                {disableNormalization: false}
            );
            
            this.oscNode.setPeriodicWave(wave);
            this.needsWaveUpdate = false;
        } catch (e) {
            console.error("Error updating Channel3 waveform:", e);
        }
    }

    play() {
        if (this.playing || !this.enabled || !this.isConnected) return;
        
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Update the waveform if needed
        if (this.needsWaveUpdate) {
            this.updateWaveform();
        }
        
        // Set the volume based on volume code
        this.updateVolume();
        
        // Reset length counter
        this.clockLength = 0;
    }

    stop() {
        if (!this.playing || !this.isConnected) return;
        
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        try {
            // Quickly fade out to avoid clicks
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            this.gainNode.gain.linearRampToValueAtTime(0, now + 0.003);
        } catch (e) {
            console.error("Error stopping Channel3:", e);
        }
    }

    updateVolume() {
        let volume;
        
        // GameBoy volume codes with accurate scaling
        switch(this.volumeCode) {
            case 0: volume = 0; break;
            case 1: volume = 0.04; break;  // 100% (but reduced for audio balance)
            case 2: volume = 0.02; break;  // 50% 
            case 3: volume = 0.01; break;  // 25%
        }
        
        if (this.gainNode && this.isConnected && this.playing) {
            try {
                const now = this.audioContext.currentTime;
                this.gainNode.gain.cancelScheduledValues(now);
                this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
                this.gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
            } catch (e) {
                console.error("Error updating Channel3 volume:", e);
            }
        }
    }

    update(clockElapsed) {
        if (!this.playing || !this.isConnected) return;
        
        try {
            // Handle length counter
            if (this.lengthCheck && this.soundLength > 0) {
                this.clockLength += clockElapsed;
                
                if (this.clockLength > this.soundLengthUnit) {
                    this.soundLength--;
                    this.clockLength -= this.soundLengthUnit;
                    
                    // Stop the channel when length reaches zero
                    if (this.soundLength == 0) {
                        this.setLength(0);
                        this.stop();
                    }
                }
            }
            
            // Update waveform if needed
            if (this.needsWaveUpdate) {
                this.updateWaveform();
            }
        } catch (e) {
            console.error("Error updating Channel3:", e);
        }
    }

    setFrequency(value) {
        this.frequency = value;
        
        // Clamp frequency to prevent errors
        if (this.frequency < 0) this.frequency = 0;
        if (this.frequency > 2047) this.frequency = 2047;
        
        // GameBoy Channel 3 frequency calculation: 65536/(2048-frequency) Hz
        let realFreq = 65536 / (2048 - this.frequency);
        
        // Clamp to audio range
        realFreq = Math.max(20, Math.min(20000, realFreq));
        
        if (this.oscNode && this.isConnected && 
            !isNaN(realFreq) && isFinite(realFreq)) {
            try {
                // Apply smoother frequency changes
                const now = this.audioContext.currentTime;
                this.oscNode.frequency.cancelScheduledValues(now);
                this.oscNode.frequency.setValueAtTime(this.oscNode.frequency.value, now);
                this.oscNode.frequency.linearRampToValueAtTime(realFreq, now + 0.005);
            } catch (e) {
                console.error("Error setting Channel3 frequency:", e);
            }
        }
    }

    getFrequency() {
        return this.frequency;
    }

    setLength(value) {
        this.soundLength = 256 - value;
    }

    setWaveBufferByte(index, value) {
        // Each byte contains two 4-bit samples
        const bufferIndex = index * 2;
        
        // High nibble
        this.waveBuffer[bufferIndex] = (value >> 4) & 0x0F;
        
        // Low nibble
        this.waveBuffer[bufferIndex + 1] = value & 0x0F;
        
        // Mark for update
        this.needsWaveUpdate = true;
    }

    disable() {
        this.stop();
        
        // Clean up resources
        if (this.oscNode) {
            try {
                this.oscNode.disconnect();
                this.oscNode.stop();
            } catch (e) {}
        }
        if (this.filter) {
            try {
                this.filter.disconnect();
            } catch (e) {}
        }
        if (this.gainNode) {
            try {
                this.gainNode.disconnect();
            } catch (e) {}
        }
        
        this.isConnected = false;
    }

    enable() {
        // Recreate nodes if needed
        if (!this.isConnected) {
            this.recreateNodes();
        }
    }
}

// Channel 4 implementation (noise)
export class Channel4 {
    constructor(apu, channelNumber, audioContext, destination) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;
        this.isConnected = false;
        this.frameSequencer = 0;

        // Length counter
        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.soundLength = 64; // defaults to 64 periods
        this.lengthCheck = false;

        // Envelope
        this.envelopeStep = 0;
        this.envelopeStepLength = 0x10000; // 1 / 64 seconds of instructions
        this.envelopeCheck = false;
        this.envelopeSign = 1;
        this.envelopeVolume = 0;

        // Noise parameters
        this.shiftFrequency = 0;
        this.counterStep = 0;
        this.divRatio = 0;
        this.lfsr = 0x01; // Linear Feedback Shift Register

        // Clocks
        this.clockLength = 0;
        this.clockEnvelop = 0;

        try {
            // Create audio nodes
            this.audioContext = audioContext;
            this.destination = destination;
            
            // Create the audio nodes
            this.recreateNodes();
        } catch (e) {
            console.error("Error creating Channel4:", e);
        }
    }
    
    recreateNodes() {
        try {
            // Clean up old nodes if they exist
            if (this.noiseNode) {
                this.noiseNode.disconnect();
                try {
                    this.noiseNode.stop();
                } catch (e) {}
            }
            if (this.gainNode) {
                this.gainNode.disconnect();
            }
            
            // Create new nodes for noise generation
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            // Create a filter for better noise tone
            this.filter = this.audioContext.createBiquadFilter();
            this.filter.type = 'bandpass';
            this.filter.frequency.value = 2500; // Center frequency
            this.filter.Q.value = 0.8; // Moderate width
            
            // Create a second filter for further shaping
            this.highpass = this.audioContext.createBiquadFilter();
            this.highpass.type = 'highpass';
            this.highpass.frequency.value = 200; // Remove low rumble
            this.highpass.Q.value = 0.5;
            
            // Create white noise buffer (more accurate than random)
            const bufferSize = 2 * this.audioContext.sampleRate; // 2 seconds
            const noiseBuffer = this.audioContext.createBuffer(
                1, bufferSize, this.audioContext.sampleRate
            );
            
            // Fill buffer with optimized noise
            this.generateOptimizedNoise(noiseBuffer);
            
            // Create noise source
            this.noiseNode = this.audioContext.createBufferSource();
            this.noiseNode.buffer = noiseBuffer;
            this.noiseNode.loop = true;
            
            // Connect nodes
            this.noiseNode.connect(this.filter);
            this.filter.connect(this.highpass);
            this.highpass.connect(this.gainNode);
            this.gainNode.connect(this.destination);
            
            // Start noise
            this.noiseNode.start();
            
            this.isConnected = true;
        } catch (e) {
            console.error("Error recreating Channel4 nodes:", e);
            this.isConnected = false;
        }
    }

    // Generate optimized noise that closely resembles the GameBoy noise channel
    generateOptimizedNoise(noiseBuffer) {
        try {
            const data = noiseBuffer.getChannelData(0);
            
            // Different noise generation based on counterStep mode
            if (this.counterStep === 1) {
                // 7-bit LFSR mode (metallic sound)
                this.generateLFSRNoise(data, 7);
            } else {
                // 15-bit LFSR mode (white noise)
                this.generateLFSRNoise(data, 15);
            }
        } catch (e) {
            console.error("Error generating optimized noise:", e);
            
            // Basic fallback
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                data[i] = (Math.random() * 2 - 1) * 0.3; // Reduced amplitude
            }
        }
    }
    
    // Generate LFSR noise - accurately modeling the GameBoy hardware
    generateLFSRNoise(data, bits) {
        // Initial LFSR state
        let lfsr = 0xFF;
        
        // Previous output for smoothing
        let prevOutput = 0;
        
        // Amount of smoothing to apply (0-1)
        const smoothing = bits === 7 ? 0.2 : 0.1;
        
        // Use antialiased LFSR algorithm with the correct bit patterns
        for (let i = 0; i < data.length; i++) {
            // Calculate new bit based on LFSR feedback
            const xorResult = ((lfsr & 1) ^ ((lfsr & 2) >> 1)) & 1;
            
            // Shift the register
            lfsr = (lfsr >> 1) | (xorResult << (bits - 1));
            
            // For 7-bit mode, use bit 6 as well
            if (bits === 7) {
                lfsr = (lfsr & 0x3F) | (xorResult << 6);
            }
            
            // Convert to audio signal (-0.4 to 0.4 for lower volume)
            const output = ((lfsr & 1) * 0.8 - 0.4);
            
            // Apply smoothing filter to reduce harsh edges
            data[i] = prevOutput + smoothing * (output - prevOutput);
            prevOutput = data[i];
            
            // Apply slight decorrelation to avoid repetitive patterns
            if (i % 64 === 0) {
                lfsr ^= (Date.now() & 1);
            }
        }
    }

    updateFrequency() {
        if (!this.noiseNode || !this.isConnected) return;
        
        try {
            // Calculate noise frequency based on GB parameters
            // divRatio: 0-7, shiftFrequency: 0-15
            let divider = this.divRatio ? this.divRatio * 16 : 8;
            let freq = 524288 / divider / Math.pow(2, this.shiftFrequency);
            
            // Clamp frequency to a reasonable range
            freq = Math.max(20, Math.min(20000, freq));
            
            // Update playback rate to change noise frequency
            const rate = freq / 1000; // Scale based on noise buffer design
            
            // Adjust filter frequencies based on noise parameters
            let filterFreq;
            
            if (this.counterStep === 1) {
                // Metallic noise - higher resonant frequency
                filterFreq = Math.min(freq * 2, 8000);
                this.filter.type = 'bandpass';
                this.filter.Q.value = 1.0;
            } else {
                // White noise - broader frequency range
                filterFreq = Math.min(freq * 1.5, 6000);
                this.filter.type = 'lowpass';
                this.filter.Q.value = 0.7;
            }
            
            const now = this.audioContext.currentTime;
            
            // Update playback rate with smoothing
            this.noiseNode.playbackRate.cancelScheduledValues(now);
            this.noiseNode.playbackRate.setValueAtTime(
                this.noiseNode.playbackRate.value, now
            );
            this.noiseNode.playbackRate.linearRampToValueAtTime(rate, now + 0.005);
            
            // Update filter frequency with smoothing
            this.filter.frequency.cancelScheduledValues(now);
            this.filter.frequency.setValueAtTime(this.filter.frequency.value, now);
            this.filter.frequency.linearRampToValueAtTime(filterFreq, now + 0.005);
        } catch (e) {
            console.error("Error updating Channel4 frequency:", e);
        }
    }

    play() {
        if (this.playing || !this.isConnected) return;
        
        // Recreate noise buffer if counterStep has changed since last play
        if (this.needsNoiseUpdate) {
            this.recreateNodes();
            this.needsNoiseUpdate = false;
        }
        
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Apply noise parameters
        this.updateFrequency();
        
        try {
            // Start with volume from envelope
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(0, now);
            
            // Calculate volume based on envelope
            const volume = this.envelopeVolume / 200; // Scale to appropriate range
            this.gainNode.gain.linearRampToValueAtTime(volume, now + 0.002);
        } catch (e) {
            console.error("Error playing Channel4:", e);
        }
        
        // Reset clocks for timing
        this.clockLength = 0;
        this.clockEnvelop = 0;
    }

    stop() {
        if (!this.playing || !this.isConnected) return;
        
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        try {
            // Fast fadeout to avoid clicks
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            this.gainNode.gain.linearRampToValueAtTime(0, now + 0.003);
        } catch (e) {
            console.error("Error stopping Channel4:", e);
        }
    }

    update(clockElapsed) {
        if (!this.playing || !this.isConnected) return;
        
        try {
            // Update clocks
            this.clockEnvelop += clockElapsed;
            
            // Handle volume envelope - if envelope step is active
            if (this.envelopeCheck && 
                this.clockEnvelop > this.envelopeStepLength && 
                this.envelopeStep > 0) {
                
                this.clockEnvelop -= this.envelopeStepLength;
                this.envelopeStep--;
                
                // Apply envelope by updating volume
                this.setEnvelopeVolume(this.envelopeVolume + this.envelopeSign);
            }
            
            // Handle length counter - if length check is enabled and we have time left
            if (this.lengthCheck && this.soundLength > 0) {
                this.clockLength += clockElapsed;
                
                if (this.clockLength > this.soundLengthUnit) {
                    this.soundLength--;
                    this.clockLength -= this.soundLengthUnit;
                    
                    // Stop the channel when length reaches zero
                    if (this.soundLength == 0) {
                        this.setLength(0);
                        this.stop();
                    }
                }
            }
        } catch (e) {
            console.error("Error updating Channel4:", e);
        }
    }

    setLength(value) {
        this.soundLength = 64 - (value & 0x3F);
    }

    setEnvelopeVolume(volume) {
        // Clamp volume to valid range (0-15)
        volume = Math.max(0, Math.min(15, volume));
        
        // Set envelope check flag based on conditions
        this.envelopeCheck = (volume > 0 && volume < 15 && this.envelopeStep > 0);
        this.envelopeVolume = volume;
        
        // Scale volume from 0-15 to a reasonable gain value
        const scaledVolume = this.envelopeVolume / 200;
        
        if (this.gainNode && this.isConnected && this.playing) {
            try {
                const now = this.audioContext.currentTime;
                this.gainNode.gain.cancelScheduledValues(now);
                this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
                this.gainNode.gain.linearRampToValueAtTime(scaledVolume, now + 0.01);
            } catch (e) {
                console.error("Error setting Channel4 envelope volume:", e);
            }
        }
    }

    enable() {
        // Recreate nodes if needed
        if (!this.isConnected) {
            this.recreateNodes();
        }
    }

    disable() {
        this.stop();
        
        // Clean up resources
        if (this.noiseNode) {
            try {
                this.noiseNode.disconnect();
                this.noiseNode.stop();
            } catch (e) {}
        }
        if (this.filter) {
            try {
                this.filter.disconnect();
            } catch (e) {}
        }
        if (this.highpass) {
            try {
                this.highpass.disconnect();
            } catch (e) {}
        }
        if (this.gainNode) {
            try {
                this.gainNode.disconnect();
            } catch (e) {}
        }
        
        this.isConnected = false;
    }
}