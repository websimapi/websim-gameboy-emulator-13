// audio.js - Audio Processing Unit and sound channels implementation

import { APURegisters } from './constants.js';
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

        // Create main mixer nodes
        this.leftMixer = this.audioContext.createGain();
        this.rightMixer = this.audioContext.createGain();
        this.leftMixer.connect(this.audioContext.destination);
        this.rightMixer.connect(this.audioContext.destination);
        
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 0.25; // Default master volume

        // Initialize channels
        this.channel1 = new Channel1(this, 1, this.audioContext);
        this.channel2 = new Channel2(this, 2, this.audioContext);
        this.channel3 = new Channel3(this, 3, this.audioContext);
        this.channel4 = new Channel4(this, 4, this.audioContext);

        // Initial panning setup - center all channels
        this.nr50 = 0x77; // Default volume (both VIN and normal sound)
        this.nr51 = 0xFF; // Default connections (all channels to both outputs)
        
        // Connect channels to mixers based on initial state
        this.updateChannelConnections();
        
        // Register audio worklet for noise generator
        this.setupAudioWorklets();
    }
    
    async setupAudioWorklets() {
        try {
            // Register the noise processor worklet
            await this.audioContext.audioWorklet.addModule('data:text/javascript;base64,' + btoa(`
                class NoiseProcessor extends AudioWorkletProcessor {
                    constructor() {
                        super();
                        this.lfsr = 0x7FFF; // 15-bit Linear Feedback Shift Register
                        this.divRatio = 1;
                        this.shiftFreq = 0;
                        this.counterStep = 15; // 7 or 15 bits mode
                        this.sampleRate = sampleRate;
                        this.frequency = 1000;
                        this.sampleCounter = 0;
                        
                        this.port.onmessage = (event) => {
                            if (event.data.type === 'updateParams') {
                                this.divRatio = event.data.divRatio || 1;
                                this.shiftFreq = event.data.shiftFreq || 0;
                                this.counterStep = event.data.counterStep || 15;
                                this.frequency = event.data.frequency || 1000;
                            } else if (event.data.type === 'reset') {
                                this.lfsr = 0x7FFF;
                            }
                        };
                    }
                    
                    process(inputs, outputs, parameters) {
                        const output = outputs[0];
                        const channel = output[0];
                        
                        // Calculate samples per shift based on frequency
                        const samplesPerShift = this.sampleRate / this.frequency;
                        
                        for (let i = 0; i < channel.length; i++) {
                            this.sampleCounter++;
                            
                            if (this.sampleCounter >= samplesPerShift) {
                                this.sampleCounter -= samplesPerShift;
                                
                                // Update LFSR state
                                const xorResult = ((this.lfsr & 1) ^ ((this.lfsr >> 1) & 1)) & 1;
                                this.lfsr = (this.lfsr >> 1) | (xorResult << 14);
                                
                                // If using 7-bit mode, also apply XOR to bit 6
                                if (this.counterStep === 7) {
                                    this.lfsr = (this.lfsr & ~0x40) | (xorResult << 6);
                                }
                            }
                            
                            // Output the current LFSR state - bit 0 inverted
                            channel[i] = (this.lfsr & 1) ? -1 : 1;
                        }
                        
                        return true; // Keep processor alive
                    }
                }
                
                registerProcessor('noise-processor', NoiseProcessor);
            `));
            console.log("Noise worklet registered successfully");
            
            // If Channel4 is already initialized, update it to use the worklet
            if (this.channel4) {
                this.channel4.initNoiseWorklet();
            }
        } catch (err) {
            console.error("Failed to register audio worklet:", err);
        }
    }

    connect() {
        this.channel1.enable();
        this.channel2.enable();
        this.channel3.enable();
        this.channel4.enable();
    }

    disconnect() {
        this.channel1.disable();
        this.channel2.disable();
        this.channel3.disable();
        this.channel4.disable();
        
        // Also disconnect mixers if needed
        this.leftMixer.disconnect();
        this.rightMixer.disconnect();
    }

    // Updates the states of each channel given the elapsed time
    // (in instructions) since last update
    update(clockElapsed) {
        if (this.enabled === false) return;

        this.channel1.update(clockElapsed);
        this.channel2.update(clockElapsed);
        this.channel3.update(clockElapsed);
        this.channel4.update(clockElapsed);
    }

    setSoundFlag(channel, value) {
        const mask = 0xFF - (1 << (channel - 1));
        value = value << (channel - 1);
        let byteValue = this.memory.rb(APURegisters.NR52);
        byteValue &= mask;
        byteValue |= value;
        this.memory.wb(APURegisters.NR52, byteValue);
    }

    // Update panning and mixing settings based on NR50 and NR51
    updateChannelConnections() {
        // Read current NR50 and NR51 values
        const nr50 = this.nr50;
        const nr51 = this.nr51;
        
        // Set master volume levels from NR50
        const leftVolume = ((nr50 >> 4) & 0x7) / 7;
        const rightVolume = (nr50 & 0x7) / 7;
        this.leftMixer.gain.value = leftVolume;
        this.rightMixer.gain.value = rightVolume;
        
        // Connect each channel to the appropriate mixer(s) based on NR51
        this.updateChannelConnection(this.channel1, 0, nr51);
        this.updateChannelConnection(this.channel2, 1, nr51);
        this.updateChannelConnection(this.channel3, 2, nr51);
        this.updateChannelConnection(this.channel4, 3, nr51);
    }
    
    // Helper to connect a single channel to left/right mixers as needed
    updateChannelConnection(channel, channelBitIndex, nr51) {
        const toRight = (nr51 & (1 << channelBitIndex)) !== 0;
        const toLeft = (nr51 & (1 << (channelBitIndex + 4))) !== 0;
        
        // First disconnect from both mixers
        try {
            channel.gainNode.disconnect(this.leftMixer);
            channel.gainNode.disconnect(this.rightMixer);
        } catch (e) {
            // Ignore disconnection errors
        }
        
        // Then reconnect as needed
        if (toRight) {
            channel.gainNode.connect(this.rightMixer);
        }
        if (toLeft) {
            channel.gainNode.connect(this.leftMixer);
        }
    }

    // Manage writes to audio registers
    // Will update the channels depending on the address
    manageWrite(addr, value) {
        if (this.enabled === false && addr < APURegisters.NR52) {
            return;
        }
        
        switch (addr) {
            // Channel 1 addresses
            case APURegisters.NR10:
                this.handleChannel1SweepWrite(value);
                break;
            case APURegisters.NR11:
                this.handleChannel1DutyLengthWrite(value);
                break;
            case APURegisters.NR12:
                this.handleChannel1EnvelopeWrite(value);
                break;
            case APURegisters.NR13:
                this.handleChannel1FreqLowWrite(value);
                break;
            case APURegisters.NR14:
                this.handleChannel1FreqHighWrite(value);
                break;

            // Channel 2 addresses
            case APURegisters.NR21:
                this.handleChannel2DutyLengthWrite(value);
                break;
            case APURegisters.NR22:
                this.handleChannel2EnvelopeWrite(value);
                break;
            case APURegisters.NR23:
                this.handleChannel2FreqLowWrite(value);
                break;
            case APURegisters.NR24:
                this.handleChannel2FreqHighWrite(value);
                break;

            // Channel 3 addresses
            case APURegisters.NR30:
                this.handleChannel3EnableWrite(value);
                break;
            case APURegisters.NR31:
                this.handleChannel3LengthWrite(value);
                break;
            case APURegisters.NR32:
                this.handleChannel3VolumeWrite(value);
                break;
            case APURegisters.NR33:
                this.handleChannel3FreqLowWrite(value);
                break;
            case APURegisters.NR34:
                this.handleChannel3FreqHighWrite(value);
                break;

            // Channel 4 addresses
            case APURegisters.NR41:
                this.handleChannel4LengthWrite(value);
                break;
            case APURegisters.NR42:
                this.handleChannel4EnvelopeWrite(value);
                break;
            case APURegisters.NR43:
                this.handleChannel4PolyCounterWrite(value);
                break;
            case APURegisters.NR44:
                this.handleChannel4InitFlagsWrite(value);
                break;

            // Sound control addresses
            case APURegisters.NR50:
                this.handleNR50Write(value);
                break;
            case APURegisters.NR51:
                this.handleNR51Write(value);
                break;
            case APURegisters.NR52:
                this.handleNR52Write(value);
                break;

            // Channel 3 wave bytes
            case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33: case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37:
            case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B: case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
                this.handleChannel3WaveWrite(addr, value);
                break;
        }

        // Always update memory even if emulation handling the value
        this.memory[addr] = value;
    }

    // Channel 1 handlers
    handleChannel1SweepWrite(value) {
        this.channel1.clockSweep = 0;
        this.channel1.sweepTime = ((value & 0x70) >> 4);
        this.channel1.sweepSign = (value & 0x08) ? -1 : 1;
        this.channel1.sweepShifts = (value & 0x07);
        this.channel1.sweepCount = this.channel1.sweepShifts;
    }

    handleChannel1DutyLengthWrite(value) {
        // Bits 6-7: Wave duty
        this.channel1.setDuty((value >> 6) & 0x3);
        // Bits 0-5: Sound length
        this.channel1.setLength(value & 0x3F);
    }

    handleChannel1EnvelopeWrite(value) {
        this.channel1.envelopeSign = (value & 0x08) ? 1 : -1;
        const envelopeVolume = (value & 0xF0) >> 4;
        this.channel1.setEnvelopeVolume(envelopeVolume);
        this.channel1.envelopeStep = (value & 0x07);
        this.channel1.envelopeCheck = this.channel1.envelopeStep > 0;
    }

    handleChannel1FreqLowWrite(value) {
        const frequency = this.channel1.getFrequency();
        const newFreq = (frequency & 0xF00) | value;
        this.channel1.setFrequency(newFreq);
    }

    handleChannel1FreqHighWrite(value) {
        const frequency = this.channel1.getFrequency();
        const newFreq = (frequency & 0xFF) | ((value & 0x7) << 8);
        this.channel1.setFrequency(newFreq);
        this.channel1.lengthCheck = (value & 0x40) !== 0;
        if (value & 0x80) {
            this.channel1.play();
        }
    }

    // Channel 2 handlers
    handleChannel2DutyLengthWrite(value) {
        // Bits 6-7: Wave duty
        this.channel2.setDuty((value >> 6) & 0x3);
        // Bits 0-5: Sound length
        this.channel2.setLength(value & 0x3F);
    }

    handleChannel2EnvelopeWrite(value) {
        this.channel2.envelopeSign = (value & 0x08) ? 1 : -1;
        const envelopeVolume = (value & 0xF0) >> 4;
        this.channel2.setEnvelopeVolume(envelopeVolume);
        this.channel2.envelopeStep = (value & 0x07);
        this.channel2.envelopeCheck = this.channel2.envelopeStep > 0;
    }

    handleChannel2FreqLowWrite(value) {
        const frequency = this.channel2.getFrequency();
        const newFreq = (frequency & 0xF00) | value;
        this.channel2.setFrequency(newFreq);
    }

    handleChannel2FreqHighWrite(value) {
        const frequency = this.channel2.getFrequency();
        const newFreq = (frequency & 0xFF) | ((value & 0x7) << 8);
        this.channel2.setFrequency(newFreq);
        this.channel2.lengthCheck = (value & 0x40) !== 0;
        if (value & 0x80) {
            this.channel2.play();
        }
    }

    // Channel 3 handlers
    handleChannel3EnableWrite(value) {
        this.channel3.dacEnabled = (value & 0x80) !== 0;
        if (!this.channel3.dacEnabled) {
            this.channel3.stop();
        }
    }

    handleChannel3LengthWrite(value) {
        this.channel3.setLength(value);
    }

    handleChannel3VolumeWrite(value) {
        const volumeCode = (value >> 5) & 0x3;
        let volume = 0;
        
        // Volume codes: 0 = mute, 1 = 100%, 2 = 50%, 3 = 25%
        switch (volumeCode) {
            case 0: volume = 0; break;
            case 1: volume = 1.0; break;
            case 2: volume = 0.5; break;
            case 3: volume = 0.25; break;
        }
        
        this.channel3.setVolume(volume);
    }

    handleChannel3FreqLowWrite(value) {
        const frequency = this.channel3.getFrequency();
        const newFreq = (frequency & 0xF00) | value;
        this.channel3.setFrequency(newFreq);
    }

    handleChannel3FreqHighWrite(value) {
        const frequency = this.channel3.getFrequency();
        const newFreq = (frequency & 0xFF) | ((value & 0x7) << 8);
        this.channel3.setFrequency(newFreq);
        this.channel3.lengthCheck = (value & 0x40) !== 0;
        if (value & 0x80) {
            this.channel3.play();
        }
    }

    handleChannel3WaveWrite(addr, value) {
        const index = addr - 0xFF30;
        this.channel3.setWaveBufferByte(index, value);
    }

    // Channel 4 handlers
    handleChannel4LengthWrite(value) {
        this.channel4.setLength(value & 0x3F);
    }

    handleChannel4EnvelopeWrite(value) {
        this.channel4.envelopeSign = (value & 0x08) ? 1 : -1;
        const envelopeVolume = (value & 0xF0) >> 4;
        this.channel4.setEnvelopeVolume(envelopeVolume);
        this.channel4.envelopeStep = (value & 0x07);
        this.channel4.envelopeCheck = this.channel4.envelopeStep > 0;
    }

    handleChannel4PolyCounterWrite(value) {
        // Bits 0-3: Shift clock frequency
        const shiftFreq = value & 0x0F;
        // Bits 4-5: Counter step/width
        const counterStep = (value & 0x08) ? 7 : 15;
        // Bits 6-7: Dividing ratio
        const divRatio = (value & 0x07);
        
        this.channel4.setNoiseParameters(shiftFreq, counterStep, divRatio);
    }

    handleChannel4InitFlagsWrite(value) {
        this.channel4.lengthCheck = (value & 0x40) !== 0;
        if (value & 0x80) {
            this.channel4.play();
        }
    }

    // Sound control handlers
    handleNR50Write(value) {
        this.nr50 = value;
        this.updateChannelConnections();
    }

    handleNR51Write(value) {
        this.nr51 = value;
        this.updateChannelConnections();
    }

    handleNR52Write(value) {
        const newEnabled = (value & 0x80) !== 0;
        
        if (this.enabled && !newEnabled) {
            // If turning off sound, zero all registers from NR10-NR51
            for (let i = 0xFF10; i <= 0xFF25; i++) {
                this.memory[i] = 0;
            }
            
            // Stop all channels
            this.channel1.stop();
            this.channel2.stop();
            this.channel3.stop();
            this.channel4.stop();
        }
        
        this.enabled = newEnabled;
    }
}

// Base Channel class for common functionality
class Channel {
    constructor(apu, channelNumber, audioContext) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;
        this.audioContext = audioContext;
        
        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.soundLength = 64; // defaults to 64 periods
        this.lengthCheck = false;
        this.clockLength = 0;
        
        // Setup envelope
        this.envelopeStep = 0;
        this.envelopeStepLength = 0x10000; // 1 / 64 seconds of instructions
        this.envelopeCheck = false;
        this.envelopeSign = 1;
        this.envelopeVolume = 0;
        this.clockEnvelop = 0;
        
        // Create audio nodes
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = 0;
    }
    
    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.envelopeCheck = this.envelopeStep > 0;
    }
    
    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        this.gainNode.gain.value = 0;
    }
    
    update(clockElapsed) {
        if (!this.playing) return;
        
        // Handle envelope
        if (this.envelopeCheck && this.clockEnvelop > this.envelopeStepLength && this.envelopeStep > 0) {
            this.clockEnvelop -= this.envelopeStepLength;
            this.envelopeStep--;
            
            // Calculate new volume
            let newVolume = this.envelopeVolume + this.envelopeSign;
            
            // Clamp volume between 0 and 15 (don't wrap)
            newVolume = Math.max(0, Math.min(15, newVolume));
            this.setEnvelopeVolume(newVolume);
            
            // If we've reached the volume limit or run out of steps, stop checking
            if (this.envelopeStep <= 0 || newVolume === 0 || newVolume === 15) {
                this.envelopeCheck = false;
            }
        } else {
            this.clockEnvelop += clockElapsed;
        }

        // Handle length counter
        if (this.lengthCheck && this.soundLength > 0) {
            this.clockLength += clockElapsed;
            if (this.clockLength > this.soundLengthUnit) {
                this.soundLength--;
                this.clockLength -= this.soundLengthUnit;
                if (this.soundLength === 0) {
                    this.stop();
                }
            }
        }
    }
    
    setEnvelopeVolume(volume) {
        // Clamp volume between 0 and 15
        this.envelopeVolume = Math.max(0, Math.min(15, volume));
        // Scale volume for web audio (0-1 range)
        this.gainNode.gain.value = this.envelopeVolume / 15;
    }
    
    setLength(value) {
        this.soundLength = 64 - (value & 0x3F);
    }
    
    disable() {
        this.stop();
    }
    
    enable() {
        // Will be implemented in subclasses
    }
}

// Channel 1 implementation (square wave with sweep)
export class Channel1 extends Channel {
    constructor(apu, channelNumber, audioContext) {
        super(apu, channelNumber, audioContext);

        // Sweep parameters
        this.sweepTime = 0; // from 0 to 7
        this.sweepStepLength = 0x8000; // 1 / 128 seconds of instructions
        this.sweepCount = 0;
        this.sweepShifts = 0;
        this.sweepSign = 1; // +1 / -1 for increase / decrease freq
        this.clockSweep = 0;
        
        this.frequency = 0;
        
        // Create oscillator
        this.oscillator = audioContext.createOscillator();
        this.oscillator.type = 'square';
        this.oscillator.frequency.value = 440; // Default frequency
        this.oscillator.connect(this.gainNode);
        this.oscillator.start(0);
        
        // Default duty cycle is 50%
        this.dutyCycle = 0.5;
        this.dutyCodes = [0.125, 0.25, 0.5, 0.75]; // GB's 4 duty cycles
    }

    play() {
        if (this.playing) return;
        super.play();
        
        // Make sure the gain node is connected to the outputs
        this.gainNode.disconnect();
        this.apu.updateChannelConnection(this, 0, this.apu.nr51);
        
        this.clockSweep = 0;
        if (this.sweepShifts > 0 && this.sweepTime > 0) {
            this.checkFreqSweep();
        }
    }

    stop() {
        super.stop();
        this.gainNode.disconnect();
    }

    checkFreqSweep() {
        const oldFreq = this.getFrequency();
        const newFreq = oldFreq + this.sweepSign * (oldFreq >> this.sweepShifts);
        if (newFreq > 0x7FF) {
            this.stop();
            return 0;
        }
        return newFreq;
    }

    update(clockElapsed) {
        super.update(clockElapsed);
        
        if (!this.playing) return;
        
        // Handle sweep
        if ((this.sweepCount || this.sweepTime) && this.clockSweep > (this.sweepStepLength * this.sweepTime) && this.sweepTime > 0) {
            this.clockSweep -= (this.sweepStepLength * this.sweepTime);
            this.sweepCount--;

            const newFreq = this.checkFreqSweep(); // process and check new freq
            if (newFreq > 0) {
                this.setFrequency(newFreq);
                this.checkFreqSweep(); // check again with new value
            }
        } else {
            this.clockSweep += clockElapsed;
        }
    }

    setFrequency(value) {
        this.frequency = value;
        // Calculate actual frequency for Web Audio: 131072/(2048-frequency)
        const gbFreq = 131072 / (2048 - (this.frequency & 0x7FF));
        // Exponential ramp to avoid clicks
        const currentTime = this.audioContext.currentTime;
        this.oscillator.frequency.setValueAtTime(gbFreq, currentTime);
    }

    getFrequency() {
        return this.frequency;
    }
    
    setDuty(dutyCode) {
        // Set duty cycle (0-3)
        this.dutyCycle = this.dutyCodes[dutyCode & 0x3];
        
        // Web Audio doesn't support duty cycle setting directly
        // In a full implementation, we would need to use a custom oscillator
        // or a WaveShaper to modify the square wave
        
        // As a simple approach, we still use the standard square oscillator
        // A more accurate implementation would use a custom periodic wave
    }

    disable() {
        this.oscillator.disconnect();
    }

    enable() {
        this.oscillator.connect(this.gainNode);
    }
}

// Channel 2 implementation (square wave without sweep)
export class Channel2 extends Channel {
    constructor(apu, channelNumber, audioContext) {
        super(apu, channelNumber, audioContext);
        
        this.frequency = 0;
        
        // Create oscillator
        this.oscillator = audioContext.createOscillator();
        this.oscillator.type = 'square';
        this.oscillator.frequency.value = 440; // Default frequency
        this.oscillator.connect(this.gainNode);
        this.oscillator.start(0);
        
        // Default duty cycle is 50%
        this.dutyCycle = 0.5;
        this.dutyCodes = [0.125, 0.25, 0.5, 0.75]; // GB's 4 duty cycles
    }

    play() {
        if (this.playing) return;
        super.play();
        
        // Make sure the gain node is connected to the outputs
        this.gainNode.disconnect();
        this.apu.updateChannelConnection(this, 1, this.apu.nr51);
    }

    stop() {
        super.stop();
        this.gainNode.disconnect();
    }

    setFrequency(value) {
        this.frequency = value;
        // Calculate actual frequency for Web Audio: 131072/(2048-frequency)
        const gbFreq = 131072 / (2048 - (this.frequency & 0x7FF));
        // Exponential ramp to avoid clicks
        const currentTime = this.audioContext.currentTime;
        this.oscillator.frequency.setValueAtTime(gbFreq, currentTime);
    }

    getFrequency() {
        return this.frequency;
    }
    
    setDuty(dutyCode) {
        // Set duty cycle (0-3)
        this.dutyCycle = this.dutyCodes[dutyCode & 0x3];
        
        // Web Audio doesn't support duty cycle setting directly
        // In a full implementation, we would need to use a custom oscillator
        // or a WaveShaper to modify the square wave
    }

    disable() {
        this.oscillator.disconnect();
    }

    enable() {
        this.oscillator.connect(this.gainNode);
    }
}

// Channel 3 implementation (wave form)
export class Channel3 extends Channel {
    constructor(apu, channelNumber, audioContext) {
        super(apu, channelNumber, audioContext);

        this.frequency = 0;
        this.dacEnabled = false;
        this.volumeShift = 0;
        
        // Create buffer for the wave
        this.buffer = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            this.buffer[i] = 0;
        }
        
        // Create audio nodes for wave playback
        this.baseSpeed = 65536;
        this.waveBuffer = audioContext.createBuffer(1, 32, this.baseSpeed);
        this.waveBuffer.copyToChannel(this.buffer, 0);
        
        this.createBufferSource();
    }
    
    createBufferSource() {
        if (this.bufferSource) {
            try {
                this.bufferSource.stop();
                this.bufferSource.disconnect();
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        
        this.bufferSource = this.audioContext.createBufferSource();
        this.bufferSource.buffer = this.waveBuffer;
        this.bufferSource.loop = true;
        this.bufferSource.connect(this.gainNode);
    }

    play() {
        if (this.playing || !this.dacEnabled) return;
        super.play();
        
        // Update wave buffer and start playback
        this.waveBuffer.copyToChannel(this.buffer, 0);
        
        // Create a new buffer source to restart playback
        this.createBufferSource();
        this.bufferSource.start(0);
        
        // Connect to mixers
        this.gainNode.disconnect();
        this.apu.updateChannelConnection(this, 2, this.apu.nr51);
    }

    stop() {
        super.stop();
        this.gainNode.disconnect();
        
        try {
            this.bufferSource.stop();
        } catch (e) {
            // Ignore errors during stop
        }
    }

    setFrequency(value) {
        this.frequency = value;
        if (this.bufferSource) {
            // Calculate actual frequency for GB: 65536 / (2048 - frequency)
            const gbRate = 65536 / (2048 - (this.frequency & 0x7FF));
            // Set the playback rate
            const rate = gbRate / this.baseSpeed;
            this.bufferSource.playbackRate.setValueAtTime(rate, this.audioContext.currentTime);
        }
    }

    getFrequency() {
        return this.frequency;
    }

    setLength(value) {
        this.soundLength = 256 - value;
    }
    
    setVolume(volume) {
        if (this.gainNode) {
            this.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
        }
    }

    setWaveBufferByte(index, value) {
        const bufferIndex = index * 2;

        // Convert each 4-bit sample to a float in the range -1 to 1
        this.buffer[bufferIndex] = ((value >> 4) & 0xF) / 7.5 - 1;
        this.buffer[bufferIndex + 1] = (value & 0xF) / 7.5 - 1;
        
        // If the channel is playing, update the wave buffer
        if (this.playing) {
            this.waveBuffer.copyToChannel(this.buffer, 0);
        }
    }

    disable() {
        if (this.bufferSource) {
            try {
                this.bufferSource.disconnect();
            } catch (e) {
                // Ignore disconnect errors
            }
        }
    }

    enable() {
        if (this.bufferSource) {
            this.bufferSource.connect(this.gainNode);
        }
    }
}

// Channel 4 implementation (noise) with AudioWorklet
export class Channel4 extends Channel {
    constructor(apu, channelNumber, audioContext) {
        super(apu, channelNumber, audioContext);
        
        // LFSR parameters
        this.shiftFrequency = 0;
        this.counterStep = 15; // 7 or 15 (narrow or wide)
        this.divRatio = 0;
        this.noiseFrequency = 1000; // Default frequency
        
        // Initialize with a fallback mechanism in case AudioWorklet is not available
        this.hasWorklet = false;
        this.workletNode = null;
        
        // Create a fallback oscillator with noise approximation
        this.noiseNode = this.createNoiseNode();
        this.noiseNode.connect(this.gainNode);
        
        // Try to initialize the AudioWorklet
        this.initNoiseWorklet();
    }
    
    // Create a noise-like sound using existing Web Audio nodes as fallback
    createNoiseNode() {
        // Create a buffer with random values
        const bufferSize = 2 * this.audioContext.sampleRate;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        
        // Create noise source
        const whiteNoise = this.audioContext.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;
        whiteNoise.start(0);
        
        return whiteNoise;
    }
    
    // Initialize the AudioWorklet for noise generation
    async initNoiseWorklet() {
        try {
            // Check if the worklet is available (should be registered by APU)
            if (this.audioContext.audioWorklet) {
                // Create the AudioWorkletNode
                this.workletNode = new AudioWorkletNode(this.audioContext, 'noise-processor');
                
                // Connect it properly
                this.workletNode.connect(this.gainNode);
                
                // Disconnect the fallback noise
                this.noiseNode.disconnect();
                
                // Set flag indicating we're using the worklet
                this.hasWorklet = true;
                
                console.log("Channel 4 using AudioWorklet");
                
                // Update parameters
                this.updateWorkletParameters();
            }
        } catch (err) {
            console.error("Error initializing noise worklet:", err);
            // Keep using the fallback mechanism
        }
    }
    
    // Update the worklet parameters
    updateWorkletParameters() {
        if (this.hasWorklet && this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'updateParams',
                divRatio: this.divRatio === 0 ? 0.5 : this.divRatio,
                shiftFreq: this.shiftFrequency,
                counterStep: this.counterStep,
                frequency: this.noiseFrequency
            });
        }
    }
    
    play() {
        if (this.playing) return;
        super.play();
        
        // Reset the noise generator
        if (this.hasWorklet && this.workletNode) {
            this.workletNode.port.postMessage({ type: 'reset' });
        }
        
        // Connect to mixers
        this.gainNode.disconnect();
        this.apu.updateChannelConnection(this, 3, this.apu.nr51);
    }
    
    stop() {
        super.stop();
        this.gainNode.disconnect();
    }
    
    setNoiseParameters(shiftFreq, counterStep, divRatio) {
        this.shiftFrequency = shiftFreq;
        this.counterStep = counterStep;
        this.divRatio = divRatio;
        
        // Calculate actual frequency for the noise generator
        // The formula is: 524288 / r / 2^(shiftFreq)
        // where r is the dividing ratio (divisor)
        const r = divRatio === 0 ? 0.5 : divRatio;
        this.noiseFrequency = 524288 / r / Math.pow(2, shiftFreq);
        
        // Update worklet parameters
        this.updateWorkletParameters();
    }
    
    setEnvelopeVolume(volume) {
        super.setEnvelopeVolume(volume);
    }
    
    disable() {
        if (this.hasWorklet && this.workletNode) {
            this.workletNode.disconnect();
        } else if (this.noiseNode) {
            this.noiseNode.disconnect();
        }
    }
    
    enable() {
        if (this.hasWorklet && this.workletNode) {
            this.workletNode.connect(this.gainNode);
        } else if (this.noiseNode) {
            this.noiseNode.connect(this.gainNode);
        }
    }
}