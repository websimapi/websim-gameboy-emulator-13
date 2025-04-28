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
            this.masterGain.gain.value = 0.1; // Lower overall volume even more
            this.masterGain.connect(this.audioContext.destination);
            
            // Create a compressor to prevent audio clipping
            this.compressor = this.audioContext.createDynamicsCompressor();
            this.compressor.threshold.value = -15;
            this.compressor.knee.value = 40;
            this.compressor.ratio.value = 12;
            this.compressor.attack.value = 0;
            this.compressor.release.value = 0.25;
            this.compressor.connect(this.masterGain);
            
            this.channel1 = new Channel1(this, 1, this.audioContext, this.compressor);
            this.channel2 = new Channel1(this, 2, this.audioContext, this.compressor);
            this.channel3 = new Channel3(this, 3, this.audioContext, this.compressor);
            this.channel4 = new Channel4(this, 4, this.audioContext, this.compressor);
            
            // Initialize update counters
            this.updateCounter = 0;
            this.updateFrequency = 128; // Only update audio every 128 cycles for better performance
            
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

        // Throttle audio updates to improve performance
        this.updateCounter += clockElapsed;
        if (this.updateCounter < this.updateFrequency) {
            return;
        }
        
        const actualElapsed = this.updateCounter;
        this.updateCounter = 0;

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

    setSoundFlag(channel, value) {
        if (!this.memory) return;
        
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
                case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33: case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37:
                case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B: case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
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
                        for (var i = 0xFF10; i < 0xFF27; i++)
                            this.memory[i] = 0;
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
                this.oscillator.stop();
            }
            if (this.gainNode) {
                this.gainNode.disconnect();
            }
            
            // Create new nodes
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            this.oscillator = this.audioContext.createOscillator();
            this.oscillator.type = 'square';
            this.oscillator.frequency.value = 440; // A4 note
            
            // Connect to destination
            this.oscillator.connect(this.gainNode);
            this.gainNode.connect(this.destination);
            
            // Start oscillator (it will keep running but with zero gain until needed)
            this.oscillator.start();
            
            this.isConnected = true;
        } catch (e) {
            console.error("Error recreating nodes:", e);
            this.isConnected = false;
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
        
        // Smoothly ramp up volume to avoid clicks
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(0, now);
        
        // Calculate scaled volume
        const scaledVolume = this.envelopeVolume / 150;
        this.gainNode.gain.linearRampToValueAtTime(scaledVolume, now + 0.005);
        
        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;
        if (this.sweepShifts > 0) this.checkFreqSweep();
    }

    stop() {
        if (!this.playing || !this.isConnected) return;
        
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        try {
            // Smoothly ramp down volume to avoid clicks
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            this.gainNode.gain.linearRampToValueAtTime(0, now + 0.005);
        } catch (e) {
            console.error("Error stopping channel:", e);
        }
    }

    updateDutyCycle() {
        // We're using OscillatorNode which doesn't support custom duty cycles
        // In a more advanced implementation, we would use a WaveShaper or custom
        // PeriodicWave to implement the different duty cycles
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
        if (!this.playing || !this.isConnected) return;
        
        try {
            this.clockEnvelop += clockElapsed;
            this.clockSweep += clockElapsed;

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
        } catch (e) {
            console.error("Error updating channel:", e);
        }
    }

    setFrequency(value) {
        this.frequency = value;
        
        // Clamp frequency to prevent errors
        if (this.frequency < 0) this.frequency = 0;
        if (this.frequency > 2047) this.frequency = 2047;
        
        // GB frequency calculation: 131072/(2048-frequency)
        // Clamp frequency to a reasonable range (20-20,000 Hz)
        let realFreq = 131072 / (2048 - this.frequency);
        realFreq = Math.max(20, Math.min(20000, realFreq));
        
        if (this.oscillator && this.isConnected && !isNaN(realFreq) && isFinite(realFreq)) {
            try {
                // Apply smoothing to frequency changes
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
        volume = Math.max(0, Math.min(15, volume)); // Clamp between 0-15
        this.envelopeCheck = volume > 0 && volume < 15 && this.envelopeStep > 0;
        this.envelopeVolume = volume;
        
        // Scale volume from 0-15 to a reasonable gain value
        const scaledVolume = this.envelopeVolume / 150;
        
        if (this.gainNode && this.isConnected && this.playing) {
            try {
                const now = this.audioContext.currentTime;
                this.gainNode.gain.cancelScheduledValues(now);
                this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
                this.gainNode.gain.linearRampToValueAtTime(scaledVolume, now + 0.01);
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
        this.recreateBufferSource = false;

        this.soundLength = 0;
        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.lengthCheck = false;

        this.clockLength = 0;
        this.frequency = 0;

        // Create the wave buffer with 32 samples (4 bits x 16 bytes)
        this.buffer = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            this.buffer[i] = 0;
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
            if (this.bufferSource) {
                this.bufferSource.disconnect();
                this.bufferSource.stop();
            }
            if (this.gainNode) {
                this.gainNode.disconnect();
            }
            
            // Create new nodes
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            this.baseSpeed = 22050; // Lower sample rate for better performance
            this.waveBuffer = this.audioContext.createBuffer(1, 32, this.baseSpeed);
            this.channelData = this.waveBuffer.getChannelData(0);
            
            // Fill the buffer with initial data
            for (let i = 0; i < 32; i++) {
                this.channelData[i] = this.buffer[i];
            }
            
            this.bufferSource = this.audioContext.createBufferSource();
            this.bufferSource.buffer = this.waveBuffer;
            this.bufferSource.loop = true;
            
            // Connect to destination
            this.bufferSource.connect(this.gainNode);
            this.gainNode.connect(this.destination);
            
            this.bufferSource.start();
            
            this.isConnected = true;
        } catch (e) {
            console.error("Error recreating Channel3 nodes:", e);
            this.isConnected = false;
        }
    }

    play() {
        if (this.playing || !this.enabled || !this.isConnected) return;
        
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
        if (!this.playing || !this.isConnected) return;
        
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        try {
            // Fade out to avoid clicks
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            this.gainNode.gain.linearRampToValueAtTime(0, now + 0.005);
        } catch (e) {
            console.error("Error stopping Channel3:", e);
        }
    }

    updateVolume() {
        let volume = 0;
        
        // Volume codes: 0=0%, 1=100%, 2=50%, 3=25%
        switch(this.volumeCode) {
            case 0: volume = 0; break;
            case 1: volume = 0.1; break;  // Reduced from 0.15
            case 2: volume = 0.05; break; // Reduced from 0.075
            case 3: volume = 0.025; break;// Reduced from 0.0375
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

    updateWaveBuffer() {
        if (!this.isConnected || !this.channelData) return;
        
        try {
            // Copy the wave pattern to the buffer data
            for (let i = 0; i < 32; i++) {
                this.channelData[i] = this.buffer[i];
            }
            
            // If we need to recreate the buffer source
            if (this.recreateBufferSource) {
                if (this.bufferSource) {
                    this.bufferSource.disconnect();
                    this.bufferSource.stop();
                }
                
                this.bufferSource = this.audioContext.createBufferSource();
                this.bufferSource.buffer = this.waveBuffer;
                this.bufferSource.loop = true;
                
                if (this.playbackRate && !isNaN(this.playbackRate) && isFinite(this.playbackRate) && this.playbackRate > 0) {
                    this.bufferSource.playbackRate.value = this.playbackRate;
                }
                
                this.bufferSource.connect(this.gainNode);
                this.bufferSource.start();
                
                this.recreateBufferSource = false;
            }
        } catch (e) {
            console.error("Error updating wave buffer:", e);
        }
    }

    update(clockElapsed) {
        if (!this.playing || !this.isConnected) return;
        
        try {
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
            
            // Check if we need to update the wave buffer
            if (this.recreateBufferSource) {
                this.updateWaveBuffer();
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
        
        // GB frequency calculation: 65536/(2048-frequency)
        let realFreq = 65536 / (2048 - (this.frequency & 0x7FF));
        
        // Clamp frequency to a reasonable range (20-20,000 Hz)
        realFreq = Math.max(20, Math.min(20000, realFreq));
        
        // Calculate playback rate based on our buffer's base speed
        this.playbackRate = realFreq / this.baseSpeed;
        
        if (this.bufferSource && this.isConnected && !isNaN(this.playbackRate) && isFinite(this.playbackRate) && this.playbackRate > 0) {
            try {
                // Apply smoothing to frequency changes
                const now = this.audioContext.currentTime;
                this.bufferSource.playbackRate.cancelScheduledValues(now);
                this.bufferSource.playbackRate.setValueAtTime(this.bufferSource.playbackRate.value, now);
                this.bufferSource.playbackRate.linearRampToValueAtTime(this.playbackRate, now + 0.005);
            } catch (e) {
                console.error("Error setting Channel3 frequency:", e);
            }
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
        
        // Clean up resources
        if (this.bufferSource) {
            try {
                this.bufferSource.disconnect();
                this.bufferSource.stop();
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
            if (this.noiseSource) {
                this.noiseSource.disconnect();
                this.noiseSource.stop();
            }
            if (this.gainNode) {
                this.gainNode.disconnect();
            }
            
            // Create new nodes
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            // Create noise buffer (shorter buffer for better performance)
            this.noiseLength = 4096;
            this.noiseBuffer = this.audioContext.createBuffer(1, this.noiseLength, this.audioContext.sampleRate);
            
            // Fill buffer with white noise
            this.generateNoiseBuffer();
            
            this.noiseSource = this.audioContext.createBufferSource();
            this.noiseSource.buffer = this.noiseBuffer;
            this.noiseSource.loop = true;
            
            // Connect to destination
            this.noiseSource.connect(this.gainNode);
            this.gainNode.connect(this.destination);
            
            this.noiseSource.start();
            
            this.isConnected = true;
        } catch (e) {
            console.error("Error recreating Channel4 nodes:", e);
            this.isConnected = false;
        }
    }

    generateNoiseBuffer() {
        try {
            // Get channel data
            const data = this.noiseBuffer.getChannelData(0);
            
            // Generate white noise or 7-bit LFSR emulation based on counterStep
            if (this.counterStep === 1) {
                // 7-bit LFSR-like noise (sounds more 'metallic')
                let lfsr = 0x01; // Initial value
                for (let i = 0; i < this.noiseLength; i++) {
                    // Emulate LFSR behavior
                    const bit = ((lfsr & 0x01) ^ ((lfsr & 0x02) >> 1)) & 0x01;
                    lfsr = ((lfsr >> 1) | (bit << 6)) & 0x7F;
                    data[i] = (lfsr / 64) - 0.5;
                }
            } else {
                // Regular white noise (sounds more 'hissy')
                for (let i = 0; i < this.noiseLength; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
            }
        } catch (e) {
            console.error("Error generating noise buffer:", e);
        }
    }

    updateFrequency() {
        if (!this.noiseSource || !this.isConnected) return;
        
        try {
            // Calculate noise frequency based on GB parameters
            // divRatio: 0-7, shiftFrequency: 0-15
            let divider = this.divRatio ? this.divRatio * 16 : 8;
            let freq = 524288 / divider / Math.pow(2, this.shiftFrequency);
            
            // Clamp frequency to a reasonable range
            freq = Math.max(20, Math.min(20000, freq));
            
            // Update playback rate to change noise frequency
            const rate = freq / 8192;
            
            const now = this.audioContext.currentTime;
            this.noiseSource.playbackRate.cancelScheduledValues(now);
            this.noiseSource.playbackRate.setValueAtTime(this.noiseSource.playbackRate.value, now);
            this.noiseSource.playbackRate.linearRampToValueAtTime(rate, now + 0.005);
        } catch (e) {
            console.error("Error updating Channel4 frequency:", e);
        }
    }

    play() {
        if (this.playing || !this.isConnected) return;
        
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Apply noise parameters and regenerate noise buffer if counterStep changed
        this.generateNoiseBuffer();
        this.updateFrequency();
        
        try {
            // Start with envelope volume
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(0, now);
            
            // Scale volume
            const scaledVolume = this.envelopeVolume / 150;
            this.gainNode.gain.linearRampToValueAtTime(scaledVolume, now + 0.005);
        } catch (e) {
            console.error("Error playing Channel4:", e);
        }
        
        this.clockLength = 0;
        this.clockEnvelop = 0;
    }

    stop() {
        if (!this.playing || !this.isConnected) return;
        
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        try {
            // Fade out to avoid clicks
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            this.gainNode.gain.linearRampToValueAtTime(0, now + 0.005);
        } catch (e) {
            console.error("Error stopping Channel4:", e);
        }
    }

    update(clockElapsed) {
        if (!this.playing || !this.isConnected) return;
        
        try {
            this.clockEnvelop += clockElapsed;
            
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
        } catch (e) {
            console.error("Error updating Channel4:", e);
        }
    }

    setLength(value) {
        this.soundLength = 64 - (value & 0x3F);
    }

    setEnvelopeVolume(volume) {
        volume = Math.max(0, Math.min(15, volume)); // Clamp between 0-15
        this.envelopeCheck = volume > 0 && volume < 15 && this.envelopeStep > 0;
        this.envelopeVolume = volume;
        
        // Scale volume from 0-15 to a reasonable gain value
        const scaledVolume = this.envelopeVolume / 150;
        
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
        if (this.noiseSource) {
            try {
                this.noiseSource.disconnect();
                this.noiseSource.stop();
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