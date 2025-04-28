// audio.js - Audio Processing Unit and sound channels implementation

import { Util } from './utils.js';

// Audio Processing unit
// Listens the write accesses to the audio-reserved memory addresses
// and dispatches the data to the sound channels
export class APU {
    constructor(memory) {
        this.memory = memory;
        this.enabled = false;
        
        // Timing constants from GameBoy hardware specs
        this.cyclesPerSecond = 4194304; // GB CPU speed in Hz
        this.frameSequencerRate = this.cyclesPerSecond / 512; // Frame sequencer steps at 512Hz
        this.frameSequencerCounter = 0;
        this.frameSequenceStep = 0;
        
        // Master volume control (0-1)
        this.masterVolume = 0.15;
        
        // Channel panning (NR50, NR51 registers)
        this.leftVolume = 7;
        this.rightVolume = 7;
        this.channelControl = 0xFF; // Which channels output to which terminal
        
        // Initialize audio context safely
        this.initAudioContext();
        
        // Channel setup with improved buffer management
        this.setupChannels();
    }
    
    initAudioContext() {
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext({
                latencyHint: 'interactive',
                sampleRate: 44100 // Standard sample rate
            });
            
            // Create a main gain node for master volume control - ensure finite value
            this.masterGainNode = this.audioContext.createGain();
            this.masterGainNode.gain.value = Math.max(0, Math.min(1, this.masterVolume || 0.15));
            this.masterGainNode.connect(this.audioContext.destination);
            
            // Create stereo panning
            this.stereoPanner = this.audioContext.createStereoPanner();
            this.stereoPanner.pan.value = 0; // Center pan
            this.stereoPanner.connect(this.masterGainNode);
            
            // Create analyzer for visualization (optional)
            this.analyzer = this.audioContext.createAnalyser();
            this.analyzer.fftSize = 256;
            this.analyzer.connect(this.stereoPanner);
            
            console.log("Audio context initialized successfully");
        } catch (e) {
            console.error("Failed to initialize Web Audio API:", e);
            this.audioContext = null;
        }
    }
    
    setupChannels() {
        if (!this.audioContext) return;
        
        try {
            // Create mixer nodes for left and right channels
            this.leftMixer = this.audioContext.createGain();
            this.leftMixer.gain.value = 0.5; // Start at half volume
            
            this.rightMixer = this.audioContext.createGain();
            this.rightMixer.gain.value = 0.5; // Start at half volume
            
            // Connect mixers to the analyser
            this.leftMixer.connect(this.analyzer);
            this.rightMixer.connect(this.analyzer);
            
            // Initialize audio channels with improved configuration
            this.channel1 = new Channel1(this, 1);
            this.channel2 = new Channel2(this, 2);
            this.channel3 = new Channel3(this, 3);
            this.channel4 = new Channel4(this, 4);
            
            // Update channel panning
            this.updateChannelPanning();
        } catch (e) {
            console.error("Error setting up audio channels:", e);
        }
    }
    
    updateChannelPanning() {
        if (!this.audioContext || !this.leftMixer || !this.rightMixer) return;
        
        try {
            const panValues = this.memory.rb(0xFF25) || 0; // NR51 register
            
            // Update each channel's connection to the mixers if they exist
            if (this.channel1) {
                this.channel1.setOutputPanning(
                    (panValues & 0x10) !== 0, // Left
                    (panValues & 0x01) !== 0  // Right
                );
            }
            
            if (this.channel2) {
                this.channel2.setOutputPanning(
                    (panValues & 0x20) !== 0, // Left
                    (panValues & 0x02) !== 0  // Right
                );
            }
            
            if (this.channel3) {
                this.channel3.setOutputPanning(
                    (panValues & 0x40) !== 0, // Left
                    (panValues & 0x04) !== 0  // Right
                );
            }
            
            if (this.channel4) {
                this.channel4.setOutputPanning(
                    (panValues & 0x80) !== 0, // Left
                    (panValues & 0x08) !== 0  // Right
                );
            }
            
            // Update master volumes
            const volReg = this.memory.rb(0xFF24) || 0; // NR50 register
            this.leftVolume = (volReg >> 4) & 0x07;
            this.rightVolume = volReg & 0x07;
            
            // Normalize to 0-1 range and apply
            if (this.leftMixer && this.leftMixer.gain) {
                this.leftMixer.gain.value = this.leftVolume / 7;
            }
            
            if (this.rightMixer && this.rightMixer.gain) {
                this.rightMixer.gain.value = this.rightVolume / 7;
            }
        } catch (e) {
            console.error("Error updating channel panning:", e);
        }
    }

    connect() {
        if (!this.audioContext) return;
        
        // Resume audio context if suspended
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume().then(() => {
                console.log("Audio context resumed successfully");
                this.enabled = true;
                this.enableChannels();
            }).catch(err => console.error("Error resuming audio context:", err));
        } else {
            this.enabled = true;
            this.enableChannels();
        }
    }

    disconnect() {
        this.enabled = false;
        this.disableChannels();
    }
    
    enableChannels() {
        if (this.channel1) this.channel1.enable();
        if (this.channel2) this.channel2.enable();
        if (this.channel3) this.channel3.enable();
        if (this.channel4) this.channel4.enable();
    }
    
    disableChannels() {
        if (this.channel1) this.channel1.disable();
        if (this.channel2) this.channel2.disable();
        if (this.channel3) this.channel3.disable();
        if (this.channel4) this.channel4.disable();
    }

    // Updates the states of each channel given the elapsed time
    update(clockElapsed) {
        if (!this.enabled || !this.audioContext) return;

        // Update frame sequencer
        this.frameSequencerCounter += clockElapsed;
        if (this.frameSequencerCounter >= this.cyclesPerSecond / 512) {
            this.frameSequencerCounter -= this.cyclesPerSecond / 512;
            this.updateFrameSequencer();
        }

        // Update channels with cycle accurate timing
        if (this.channel1) this.channel1.update(clockElapsed);
        if (this.channel2) this.channel2.update(clockElapsed);
        if (this.channel3) this.channel3.update(clockElapsed);
        if (this.channel4) this.channel4.update(clockElapsed);
    }
    
    updateFrameSequencer() {
        // The frame sequencer clocks different components at different rates
        switch (this.frameSequenceStep) {
            case 0:
                // Length counter
                if (this.channel1) this.channel1.updateLength();
                if (this.channel2) this.channel2.updateLength();
                if (this.channel3) this.channel3.updateLength();
                if (this.channel4) this.channel4.updateLength();
                break;
            case 2:
                // Length counter and sweep
                if (this.channel1) {
                    this.channel1.updateLength();
                    this.channel1.updateSweep();
                }
                if (this.channel2) this.channel2.updateLength();
                if (this.channel3) this.channel3.updateLength();
                if (this.channel4) this.channel4.updateLength();
                break;
            case 4:
                // Length counter
                if (this.channel1) this.channel1.updateLength();
                if (this.channel2) this.channel2.updateLength();
                if (this.channel3) this.channel3.updateLength();
                if (this.channel4) this.channel4.updateLength();
                break;
            case 6:
                // Length counter and sweep
                if (this.channel1) {
                    this.channel1.updateLength();
                    this.channel1.updateSweep();
                }
                if (this.channel2) this.channel2.updateLength();
                if (this.channel3) this.channel3.updateLength();
                if (this.channel4) this.channel4.updateLength();
                break;
            case 7:
                // Volume envelope
                if (this.channel1) this.channel1.updateEnvelope();
                if (this.channel2) this.channel2.updateEnvelope();
                if (this.channel4) this.channel4.updateEnvelope();
                break;
        }
        
        // Increment frame sequence step (0-7)
        this.frameSequenceStep = (this.frameSequenceStep + 1) % 8;
    }

    setSoundFlag(channel, value) {
        if (!this.memory) return;
        
        var mask = 0xFF - (1 << (channel - 1));
        value = value << (channel - 1);
        var byteValue = this.memory.rb(APU.registers.NR52) || 0;
        byteValue &= mask;
        byteValue |= value;
        this.memory[APU.registers.NR52] = byteValue;
    }

    // Manage writes to audio registers
    manageWrite(addr, value) {
        if (!this.memory) return;
        
        if (this.enabled == false && addr < APU.registers.NR52) {
            return;
        }
        this.memory[addr] = value;

        try {
            switch (addr) {
                // Master control
                case 0xFF24: // NR50 - Master volume and VIN panning
                    this.updateChannelPanning();
                    break;
                    
                case 0xFF25: // NR51 - Sound panning
                    this.updateChannelPanning();
                    break;
                    
                // Channel 1 addresses
                case 0xFF10: // NR10 - Channel 1 Sweep
                    if (this.channel1) this.channel1.updateSweepParams(value);
                    break;
                    
                case 0xFF11: // NR11 - Channel 1 Length Timer & Duty Cycle
                    if (this.channel1) this.channel1.setLengthAndDuty(value);
                    break;
                    
                case 0xFF12: // NR12 - Channel 1 Volume Envelope
                    if (this.channel1) this.channel1.setEnvelope(value);
                    break;
                    
                case 0xFF13: // NR13 - Channel 1 Frequency (low)
                    if (this.channel1) this.channel1.setFrequencyLow(value);
                    break;
                    
                case 0xFF14: // NR14 - Channel 1 Frequency (high) & Control
                    if (this.channel1) this.channel1.setFrequencyHigh(value);
                    break;

                // Channel 2 addresses
                case 0xFF16: // NR21 - Channel 2 Length Timer & Duty Cycle
                    if (this.channel2) this.channel2.setLengthAndDuty(value);
                    break;
                    
                case 0xFF17: // NR22 - Channel 2 Volume Envelope
                    if (this.channel2) this.channel2.setEnvelope(value);
                    break;
                    
                case 0xFF18: // NR23 - Channel 2 Frequency (low)
                    if (this.channel2) this.channel2.setFrequencyLow(value);
                    break;
                    
                case 0xFF19: // NR24 - Channel 2 Frequency (high) & Control
                    if (this.channel2) this.channel2.setFrequencyHigh(value);
                    break;

                // Channel 3 addresses
                case 0xFF1A: // NR30 - Channel 3 Sound on/off
                    if (this.channel3) this.channel3.setEnabled(value);
                    break;
                    
                case 0xFF1B: // NR31 - Channel 3 Sound Length
                    if (this.channel3) this.channel3.setLength(value);
                    break;
                    
                case 0xFF1C: // NR32 - Channel 3 Select output level
                    if (this.channel3) this.channel3.setOutputLevel(value);
                    break;
                    
                case 0xFF1D: // NR33 - Channel 3 Frequency (low)
                    if (this.channel3) this.channel3.setFrequencyLow(value);
                    break;
                    
                case 0xFF1E: // NR34 - Channel 3 Frequency (high) & Control
                    if (this.channel3) this.channel3.setFrequencyHigh(value);
                    break;

                // Channel 4 addresses
                case 0xFF20: // NR41 - Channel 4 Sound Length
                    if (this.channel4) this.channel4.setLength(value);
                    break;
                    
                case 0xFF21: // NR42 - Channel 4 Volume Envelope
                    if (this.channel4) this.channel4.setEnvelope(value);
                    break;
                    
                case 0xFF22: // NR43 - Channel 4 Polynomial Counter
                    if (this.channel4) this.channel4.setNoise(value);
                    break;
                    
                case 0xFF23: // NR44 - Channel 4 Counter/consecutive & Control
                    if (this.channel4) this.channel4.setControl(value);
                    break;

                // channel 3 wave bytes
                case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33: case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37:
                case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B: case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
                    if (this.channel3) {
                        const index = addr - 0xFF30;
                        this.channel3.setWaveBufferByte(index, value);
                    }
                    break;

                // general audio switch
                case 0xFF26: // NR52 - Sound on/off
                    value &= 0xF0;
                    this.memory[addr] = value;
                    const newEnabled = (value & 0x80) !== 0;
                    
                    if (this.enabled !== newEnabled) {
                        this.enabled = newEnabled;
                        
                        if (!this.enabled) {
                            // Reset all sound registers when powered off
                            for (var i = 0xFF10; i < 0xFF26; i++) {
                                this.memory[i] = 0;
                            }
                            this.disableChannels();
                        } else {
                            this.enableChannels();
                        }
                    }
                    break;
            }
        } catch (e) {
            console.error("Error handling audio register write:", e);
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
    
    // Utility function for debugging
    getAudioState() {
        return {
            enabled: this.enabled,
            contextState: this.audioContext ? this.audioContext.state : 'none',
            channels: [
                this.channel1 ? this.channel1.getDebugState() : null,
                this.channel2 ? this.channel2.getDebugState() : null,
                this.channel3 ? this.channel3.getDebugState() : null,
                this.channel4 ? this.channel4.getDebugState() : null
            ]
        };
    }
}

// Base Channel class with common functionality
class Channel {
    constructor(apu, channelNumber) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.audioContext = apu.audioContext;
        this.playing = false;
        this.enabled = false;
        this.lengthCounter = 0;
        this.lengthEnabled = false;
        this.leftOutput = false;
        this.rightOutput = false;
        
        // Create gain node for this channel if audio context exists
        if (this.audioContext) {
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            // Create a splitter for stereo control
            this.leftGain = this.audioContext.createGain();
            this.leftGain.gain.value = 0;
            
            this.rightGain = this.audioContext.createGain();
            this.rightGain.gain.value = 0;
            
            // Connect gain to panning
            this.gainNode.connect(this.leftGain);
            this.gainNode.connect(this.rightGain);
            
            // Connect to appropriate mixers
            if (this.apu.leftMixer) this.leftGain.connect(this.apu.leftMixer);
            if (this.apu.rightMixer) this.rightGain.connect(this.apu.rightMixer);
        }
    }
    
    enable() {
        this.enabled = true;
    }
    
    disable() {
        this.enabled = false;
        this.playing = false;
        if (this.gainNode) {
            this.gainNode.gain.value = 0;
        }
    }
    
    setOutputPanning(left, right) {
        this.leftOutput = left;
        this.rightOutput = right;
        
        if (this.leftGain) {
            this.leftGain.gain.value = left ? 1.0 : 0.0;
        }
        
        if (this.rightGain) {
            this.rightGain.gain.value = right ? 1.0 : 0.0;
        }
    }
    
    updateLength() {
        if (this.lengthEnabled && this.lengthCounter > 0) {
            this.lengthCounter--;
            if (this.lengthCounter === 0) {
                this.stop();
            }
        }
    }
    
    stop() {
        this.playing = false;
        if (this.apu) {
            this.apu.setSoundFlag(this.channelNumber, 0);
        }
        if (this.gainNode) {
            this.gainNode.gain.value = 0;
        }
    }
    
    // Safely set volume with ramping to avoid clicks
    setVolume(volume) {
        if (!this.audioContext || !this.gainNode) return;
        
        // Clamp volume to valid range
        volume = Math.max(0, Math.min(1, volume));
        
        try {
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            this.gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
        } catch (e) {
            console.error("Error setting volume:", e);
            // Fallback to direct assignment if ramping fails
            this.gainNode.gain.value = volume;
        }
    }
    
    getDebugState() {
        return {
            channelNumber: this.channelNumber,
            playing: this.playing,
            enabled: this.enabled,
            lengthCounter: this.lengthCounter,
            lengthEnabled: this.lengthEnabled,
            frequency: this.frequency || 0,
            volume: this.gainNode ? this.gainNode.gain.value : 0
        };
    }
    
    // These methods should be implemented by each channel
    updateSweep() {}
    updateEnvelope() {}
    update(clockElapsed) {}
}

// Channel 1 implementation (Square wave with sweep)
export class Channel1 extends Channel {
    constructor(apu, channelNumber) {
        super(apu, channelNumber);
        
        // Sweep parameters
        this.sweepTime = 0;
        this.sweepDirection = 0; // 0: increase, 1: decrease
        this.sweepShifts = 0;
        this.sweepEnabled = false;
        this.shadowFrequency = 0;
        this.sweepTimer = 0;
        
        // Envelope parameters
        this.envelopeVolume = 0;
        this.envelopeDirection = 0; // 0: decrease, 1: increase
        this.envelopeSweep = 0;
        this.envelopeTimer = 0;
        
        // Duty cycle (wave pattern)
        this.dutyCycle = 0;
        this.dutyPosition = 0;
        
        // GameBoy has 4 duty patterns (0-3)
        this.dutyPatterns = [
            [0, 0, 0, 0, 0, 0, 0, 1], // 12.5%
            [1, 0, 0, 0, 0, 0, 0, 1], // 25%
            [1, 0, 0, 0, 0, 1, 1, 1], // 50%
            [0, 1, 1, 1, 1, 1, 1, 0]  // 75% (inverse of 25%)
        ];
        
        // Frequency and timer tracking
        this.frequency = 0;
        this.frequencyTimer = 0;
        
        // Create oscillator if audio context exists
        if (this.audioContext) {
            this.setupOscillator();
        }
    }
    
    setupOscillator() {
        try {
            // Create oscillator
            this.oscillator = this.audioContext.createOscillator();
            this.oscillator.type = 'square';
            this.oscillator.frequency.value = 440; // Default frequency
            this.oscillator.connect(this.gainNode);
            this.oscillator.start();
            
            // Set initial duty cycle to 50%
            this.setDutyCycle(2);
        } catch (e) {
            console.error("Error setting up oscillator:", e);
            this.oscillator = null;
        }
    }
    
    setDutyCycle(dutyCycleIndex) {
        this.dutyCycle = dutyCycleIndex & 3;
        
        if (!this.oscillator) return;
        
        // Web Audio's OscillatorNode doesn't directly support
        // duty cycle control for square waves, so we'll just
        // track the current duty cycle pattern for simulation
    }
    
    updateSweepParams(value) {
        this.sweepTime = (value & 0x70) >> 4;
        this.sweepDirection = (value & 0x08) ? 1 : 0;
        this.sweepShifts = value & 0x07;
        this.sweepEnabled = this.sweepTime > 0 || this.sweepShifts > 0;
        this.sweepTimer = this.sweepTime;
        
        if (this.sweepEnabled && this.playing) {
            this.shadowFrequency = this.frequency;
            this.calculateSweep();
        }
    }
    
    setLengthAndDuty(value) {
        // Set duty cycle (bits 6-7)
        this.setDutyCycle((value >> 6) & 3);
        
        // Set length counter (bits 0-5)
        this.lengthCounter = 64 - (value & 0x3F);
    }
    
    setEnvelope(value) {
        // Initial volume (bits 4-7)
        const initialVolume = (value >> 4) & 0x0F;
        
        // Envelope direction (bit 3)
        this.envelopeDirection = (value & 0x08) ? 1 : 0;
        
        // Envelope sweep (bits 0-2)
        this.envelopeSweep = value & 0x07;
        
        if (this.playing) {
            this.setVolume(initialVolume / 15);
        }
        
        // Reset envelope timer
        this.envelopeTimer = this.envelopeSweep;
        this.envelopeVolume = initialVolume;
    }
    
    setFrequencyLow(value) {
        // Set low 8 bits of frequency
        this.frequency = (this.frequency & 0x700) | value;
        this.updateOscillatorFrequency();
    }
    
    setFrequencyHigh(value) {
        // Set high 3 bits of frequency (bits 0-2)
        this.frequency = (this.frequency & 0xFF) | ((value & 0x07) << 8);
        
        // Enable length counter if bit 6 is set
        this.lengthEnabled = (value & 0x40) !== 0;
        
        // Trigger channel if bit 7 is set
        if (value & 0x80) {
            this.trigger();
        }
        
        this.updateOscillatorFrequency();
    }
    
    trigger() {
        // If length counter is 0, set it to 64
        if (this.lengthCounter === 0) {
            this.lengthCounter = 64;
        }
        
        // Reset frequency timer
        this.frequencyTimer = 0;
        
        // Set envelope timer and initial volume
        const envelopeRegister = this.apu.memory.rb(0xFF12);
        this.envelopeVolume = (envelopeRegister >> 4) & 0x0F;
        this.envelopeTimer = this.envelopeSweep;
        
        // Start channel
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Set volume based on envelope
        this.setVolume(this.envelopeVolume / 15);
        
        // Reset sweep
        this.sweepTimer = this.sweepTime;
        
        // Do an initial sweep calculation
        if (this.sweepEnabled) {
            this.shadowFrequency = this.frequency;
            this.calculateSweep();
        }
    }
    
    updateOscillatorFrequency() {
        if (!this.playing || !this.oscillator) return;
        
        try {
            // Convert GB frequency value to actual frequency in Hz
            // GB uses period, not frequency directly - formula: 131072/(2048-frequency)
            const frequencyValue = 131072 / (2048 - this.frequency);
            
            // Ensure frequency is finite and positive
            if (isFinite(frequencyValue) && frequencyValue > 0) {
                const now = this.audioContext.currentTime;
                this.oscillator.frequency.cancelScheduledValues(now);
                this.oscillator.frequency.setValueAtTime(this.oscillator.frequency.value, now);
                this.oscillator.frequency.linearRampToValueAtTime(frequencyValue, now + 0.01);
            }
        } catch (e) {
            console.error("Error updating oscillator frequency:", e);
        }
    }
    
    calculateSweep() {
        // Skip if sweep is disabled or shift is 0
        if (!this.sweepEnabled || this.sweepShifts === 0) return;
        
        // Calculate new frequency: F' = F +/- (F >> shifts)
        const offset = this.shadowFrequency >> this.sweepShifts;
        
        if (this.sweepDirection === 1) {
            // Decrease frequency
            this.shadowFrequency -= offset;
        } else {
            // Increase frequency
            this.shadowFrequency += offset;
        }
        
        // If new frequency is > 2047, channel is disabled
        if (this.shadowFrequency > 2047 || this.shadowFrequency < 0) {
            this.stop();
            return;
        }
        
        // Apply new frequency if sweep is active
        if (this.sweepTime > 0 && this.sweepShifts > 0) {
            this.frequency = this.shadowFrequency;
            this.updateOscillatorFrequency();
        }
    }
    
    updateSweep() {
        if (!this.playing || !this.sweepEnabled || this.sweepTime === 0) return;
        
        // Update sweep timer
        if (this.sweepTimer > 0) {
            this.sweepTimer--;
            if (this.sweepTimer === 0) {
                // Reset sweep timer
                this.sweepTimer = this.sweepTime;
                
                // Calculate and apply new frequency
                this.calculateSweep();
            }
        }
    }
    
    updateEnvelope() {
        if (!this.playing || this.envelopeSweep === 0) return;
        
        // Update envelope timer
        if (this.envelopeTimer > 0) {
            this.envelopeTimer--;
            if (this.envelopeTimer === 0) {
                // Reset envelope timer
                this.envelopeTimer = this.envelopeSweep;
                
                // Skip if envelope sweep is 0
                if (this.envelopeSweep === 0) return;
                
                // Update volume based on direction
                if (this.envelopeDirection === 1) {
                    // Increase volume
                    if (this.envelopeVolume < 15) {
                        this.envelopeVolume++;
                        this.setVolume(this.envelopeVolume / 15);
                    }
                } else {
                    // Decrease volume
                    if (this.envelopeVolume > 0) {
                        this.envelopeVolume--;
                        this.setVolume(this.envelopeVolume / 15);
                    }
                }
            }
        }
    }
    
    update(clockElapsed) {
        if (!this.playing || !this.enabled) return;
        
        // Update frequency timer
        this.frequencyTimer += clockElapsed;
        
        // Update actual output
        const period = (2048 - this.frequency) * 4;
        if (this.frequencyTimer >= period) {
            this.frequencyTimer -= period;
            this.dutyPosition = (this.dutyPosition + 1) % 8;
            
            // In a hardware implementation, we'd update the waveform here
            // Since we're using Web Audio's oscillator, we don't need to
            // manually update the waveform for each cycle
        }
    }
}

// Channel 2 implementation (Square wave without sweep)
export class Channel2 extends Channel1 {
    constructor(apu, channelNumber) {
        super(apu, channelNumber);
        // Channel 2 is identical to Channel 1 except it has no sweep
        this.sweepEnabled = false;
    }
    
    // Override sweep methods to do nothing
    updateSweepParams() {
        // Channel 2 has no sweep
    }
    
    updateSweep() {
        // Channel 2 has no sweep
    }
    
    calculateSweep() {
        // Channel 2 has no sweep
    }
}

// Channel 3 implementation (Wave form)
export class Channel3 extends Channel {
    constructor(apu, channelNumber) {
        super(apu, channelNumber);
        
        // Wave table
        this.waveBuffer = new Uint8Array(16); // 16 bytes = 32 samples
        this.wavePosition = 0;
        
        // Volume level
        this.volumeCode = 0;
        this.volumeShift = 0;
        
        // Frequency
        this.frequency = 0;
        this.frequencyTimer = 0;
        
        // Create oscillator if audio context exists
        if (this.audioContext) {
            this.setupWaveform();
        }
    }
    
    setupWaveform() {
        try {
            // Create oscillator for wave channel
            this.oscillator = this.audioContext.createOscillator();
            
            // Create initial sine wave as placeholder
            this.oscillator.type = 'sine';
            this.oscillator.frequency.value = 440;
            
            // Connect oscillator to gain node
            this.oscillator.connect(this.gainNode);
            this.oscillator.start();
            
            // Update with actual wave data
            this.updateWaveform();
        } catch (e) {
            console.error("Error setting up waveform:", e);
            this.oscillator = null;
        }
    }
    
    updateWaveform() {
        if (!this.audioContext || !this.oscillator) return;
        
        try {
            // Convert 4-bit wave RAM to normalized wave data
            const real = new Float32Array(32); // Cosine terms
            const imag = new Float32Array(32); // Sine terms
            
            for (let i = 0; i < 16; i++) {
                // Wave RAM contains 2 samples per byte
                const byte = this.waveBuffer[i];
                const high = (byte >> 4) & 0x0F;
                const low = byte & 0x0F;
                
                // Convert from 4-bit to normalized -1 to 1
                real[i*2] = (high / 7.5) - 1.0;
                real[i*2+1] = (low / 7.5) - 1.0;
            }
            
            // First value determines DC offset
            real[0] = 0;
            
            // Create a periodic wave from the data
            const wave = this.audioContext.createPeriodicWave(real, imag, {
                disableNormalization: true
            });
            
            // Apply the wave to the oscillator
            this.oscillator.setPeriodicWave(wave);
        } catch (e) {
            console.error("Error updating waveform:", e);
        }
    }
    
    setEnabled(value) {
        // Bit 7 controls DAC power
        const dacEnabled = (value & 0x80) !== 0;
        
        if (!dacEnabled) {
            this.stop();
        }
        
        this.enabled = dacEnabled;
    }
    
    setLength(value) {
        this.lengthCounter = 256 - value;
    }
    
    setOutputLevel(value) {
        // Bits 5-6 control volume
        this.volumeCode = (value >> 5) & 0x03;
        
        // Convert volume code to shift amount
        switch (this.volumeCode) {
            case 0: this.volumeShift = 4; break; // Mute (shift right by 4 = divide by 16)
            case 1: this.volumeShift = 0; break; // 100% (no shift)
            case 2: this.volumeShift = 1; break; // 50% (shift right by 1 = divide by 2)
            case 3: this.volumeShift = 2; break; // 25% (shift right by 2 = divide by 4)
        }
        
        // Update volume
        if (this.playing) {
            this.updateVolume();
        }
    }
    
    updateVolume() {
        // Volume is determined by the shift value
        const volume = this.volumeCode === 0 ? 0 : 1.0 / (1 << this.volumeShift);
        this.setVolume(volume * 0.5); // Reduce by half to match other channels
    }
    
    setFrequencyLow(value) {
        // Set low 8 bits of frequency
        this.frequency = (this.frequency & 0x700) | value;
        this.updateOscillatorFrequency();
    }
    
    setFrequencyHigh(value) {
        // Set high 3 bits of frequency (bits 0-2)
        this.frequency = (this.frequency & 0xFF) | ((value & 0x07) << 8);
        
        // Enable length counter if bit 6 is set
        this.lengthEnabled = (value & 0x40) !== 0;
        
        // Trigger channel if bit 7 is set
        if (value & 0x80) {
            this.trigger();
        }
        
        this.updateOscillatorFrequency();
    }
    
    trigger() {
        if (!this.enabled) return;
        
        // If length counter is 0, set it to 256
        if (this.lengthCounter === 0) {
            this.lengthCounter = 256;
        }
        
        // Reset wave position
        this.wavePosition = 0;
        
        // Reset frequency timer
        this.frequencyTimer = 0;
        
        // Start channel
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Set volume based on output level
        this.updateVolume();
    }
    
    setWaveBufferByte(index, value) {
        if (index < 0 || index >= 16) return;
        
        this.waveBuffer[index] = value;
        
        // Update waveform if channel is enabled
        if (this.enabled) {
            this.updateWaveform();
        }
    }
    
    updateOscillatorFrequency() {
        if (!this.playing || !this.oscillator) return;
        
        try {
            // Convert GB frequency value to actual frequency in Hz
            // Wave channel: 65536 / (2048 - frequency)
            const frequencyValue = 65536 / (2048 - this.frequency);
            
            // Ensure frequency is finite and positive
            if (isFinite(frequencyValue) && frequencyValue > 0) {
                const now = this.audioContext.currentTime;
                this.oscillator.frequency.cancelScheduledValues(now);
                this.oscillator.frequency.setValueAtTime(this.oscillator.frequency.value, now);
                this.oscillator.frequency.linearRampToValueAtTime(frequencyValue, now + 0.01);
            }
        } catch (e) {
            console.error("Error updating oscillator frequency:", e);
        }
    }
    
    update(clockElapsed) {
        if (!this.playing || !this.enabled) return;
        
        // Update frequency timer
        this.frequencyTimer += clockElapsed;
        
        // Wave channel has 2x the frequency of the square channels
        const period = (2048 - this.frequency) * 2;
        
        if (this.frequencyTimer >= period) {
            this.frequencyTimer -= period;
            this.wavePosition = (this.wavePosition + 1) % 32;
            
            // In a hardware implementation, we'd read the actual wave data sample
            // Since we're using Web Audio with a custom waveform, we don't need to
            // manually update for each sample
        }
    }
}

// Channel 4 implementation (Noise)
export class Channel4 extends Channel {
    constructor(apu, channelNumber) {
        super(apu, channelNumber);
        
        // Envelope parameters
        this.envelopeVolume = 0;
        this.envelopeDirection = 0; // 0: decrease, 1: increase
        this.envelopeSweep = 0;
        this.envelopeTimer = 0;
        
        // Noise parameters
        this.shiftFrequency = 0;
        this.counterStep = 0; // 0: 15-bit, 1: 7-bit
        this.divisorCode = 0;
        this.divisor = 8;
        
        // LFSR (Linear Feedback Shift Register)
        this.lfsr = 0x7FFF;
        this.lfsrTimer = 0;
        
        // Create noise source if audio context exists
        if (this.audioContext) {
            this.setupNoise();
        }
    }
    
    setupNoise() {
        try {
            // Use AudioBuffer for noise generation
            this.noiseNode = this.audioContext.createBufferSource();
            
            // Create a 1-second buffer of noise at the context's sample rate
            const bufferSize = this.audioContext.sampleRate;
            this.noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
            
            // Generate initial noise
            this.generateNoise();
            
            // Connect noise to gain node
            this.noiseNode.buffer = this.noiseBuffer;
            this.noiseNode.loop = true;
            this.noiseNode.connect(this.gainNode);
            this.noiseNode.start();
        } catch (e) {
            console.error("Error setting up noise:", e);
            this.noiseNode = null;
        }
    }
    
    generateNoise() {
        if (!this.noiseBuffer) return;
        
        try {
            // Get the buffer data
            const data = this.noiseBuffer.getChannelData(0);
            
            // Seed LFSR with initial value
            let lfsr = 0x7FFF;
            
            // Generate noise based on current counter step mode
            for (let i = 0; i < data.length; i++) {
                // Get output bit
                const output = lfsr & 1;
                
                // Calculate feedback bit
                let bit;
                if (this.counterStep === 0) {
                    // 15-bit: bits 0 and 1
                    bit = ((lfsr & 1) ^ ((lfsr >> 1) & 1));
                } else {
                    // 7-bit: bits 0 and 6
                    bit = ((lfsr & 1) ^ ((lfsr >> 6) & 1));
                }
                
                // Shift right and set high bit to feedback
                lfsr = (lfsr >> 1) | (bit << 14);
                
                // Set output (0 = high, 1 = low)
                data[i] = output ? -0.5 : 0.5;
            }
        } catch (e) {
            console.error("Error generating noise:", e);
        }
    }
    
    setLength(value) {
        this.lengthCounter = 64 - (value & 0x3F);
    }
    
    setEnvelope(value) {
        // Initial volume (bits 4-7)
        const initialVolume = (value >> 4) & 0x0F;
        
        // Envelope direction (bit 3)
        this.envelopeDirection = (value & 0x08) ? 1 : 0;
        
        // Envelope sweep (bits 0-2)
        this.envelopeSweep = value & 0x07;
        
        if (this.playing) {
            this.setVolume(initialVolume / 15);
        }
        
        // Reset envelope timer
        this.envelopeTimer = this.envelopeSweep;
        this.envelopeVolume = initialVolume;
    }
    
    setNoise(value) {
        // Shift clock frequency (bits 4-7)
        this.shiftFrequency = (value >> 4) & 0x0F;
        
        // Counter step (bit 3)
        this.counterStep = (value & 0x08) ? 1 : 0;
        
        // Divisor code (bits 0-2)
        this.divisorCode = value & 0x07;
        
        // Calculate actual divisor
        this.divisor = this.divisorCode === 0 ? 8 : this.divisorCode * 16;
        
        // Regenerate noise with new parameters
        if (this.playing && this.noiseBuffer) {
            this.generateNoise();
            
            // Restart noise playback with new buffer
            if (this.noiseNode) {
                this.noiseNode.stop();
                this.noiseNode = this.audioContext.createBufferSource();
                this.noiseNode.buffer = this.noiseBuffer;
                this.noiseNode.loop = true;
                this.noiseNode.connect(this.gainNode);
                this.noiseNode.start();
            }
        }
    }
    
    setControl(value) {
        // Enable length counter if bit 6 is set
        this.lengthEnabled = (value & 0x40) !== 0;
        
        // Trigger channel if bit 7 is set
        if (value & 0x80) {
            this.trigger();
        }
    }
    
    trigger() {
        // If length counter is 0, set it to 64
        if (this.lengthCounter === 0) {
            this.lengthCounter = 64;
        }
        
        // Reset LFSR
        this.lfsr = 0x7FFF;
        
        // Reset frequency timer
        this.lfsrTimer = 0;
        
        // Set envelope timer and initial volume
        const envelopeRegister = this.apu ? (this.apu.memory.rb(0xFF21) || 0) : 0;
        this.envelopeVolume = (envelopeRegister >> 4) & 0x0F;
        this.envelopeTimer = this.envelopeSweep;
        
        // Start channel
        this.playing = true;
        if (this.apu) {
            this.apu.setSoundFlag(this.channelNumber, 1);
        }
        
        // Set volume based on envelope
        this.setVolume(this.envelopeVolume / 15);
        
        // Regenerate noise with fresh LFSR state
        if (this.noiseBuffer) {
            this.generateNoise();
            
            // Restart noise playback with new buffer
            if (this.noiseNode) {
                this.noiseNode.stop();
                this.noiseNode = this.audioContext.createBufferSource();
                this.noiseNode.buffer = this.noiseBuffer;
                this.noiseNode.loop = true;
                this.noiseNode.connect(this.gainNode);
                this.noiseNode.start();
            }
        }
    }
    
    updateEnvelope() {
        if (!this.playing || this.envelopeSweep === 0) return;
        
        // Update envelope timer
        if (this.envelopeTimer > 0) {
            this.envelopeTimer--;
            if (this.envelopeTimer === 0) {
                // Reset envelope timer
                this.envelopeTimer = this.envelopeSweep;
                
                // Skip if envelope sweep is 0
                if (this.envelopeSweep === 0) return;
                
                // Update volume based on direction
                if (this.envelopeDirection === 1) {
                    // Increase volume
                    if (this.envelopeVolume < 15) {
                        this.envelopeVolume++;
                        this.setVolume(this.envelopeVolume / 15);
                    }
                } else {
                    // Decrease volume
                    if (this.envelopeVolume > 0) {
                        this.envelopeVolume--;
                        this.setVolume(this.envelopeVolume / 15);
                    }
                }
            }
        }
    }
    
    update(clockElapsed) {
        if (!this.playing || !this.enabled) return;
        
        // Update LFSR timer
        this.lfsrTimer += clockElapsed;
        
        // Calculate period in CPU cycles
        const period = this.divisor << this.shiftFrequency;
        
        // Process as many LFSR steps as needed based on elapsed time
        while (this.lfsrTimer >= period) {
            this.lfsrTimer -= period;
            
            // Step LFSR
            let bit;
            if (this.counterStep === 0) {
                // 15-bit mode
                bit = ((this.lfsr & 1) ^ ((this.lfsr >> 1) & 1));
            } else {
                // 7-bit mode
                bit = ((this.lfsr & 1) ^ ((this.lfsr >> 6) & 1));
            }
            
            this.lfsr = (this.lfsr >> 1) | (bit << 14);
            
            // In a hardware implementation, we'd output based on the LFSR state
            // Since we're using Web Audio with a buffer, the output is handled by the buffer
        }
    }
}