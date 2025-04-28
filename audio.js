// audio.js - Audio Processing Unit and sound channels implementation

import { Util } from './utils.js';

// Audio Processing unit
// Listens the write accesses to the audio-reserved memory addresses
// and dispatches the data to the sound channels
export class APU {
    constructor(memory) {
        this.memory = memory;
        this.enabled = false;
        this.audioInitialized = false;
        this.masterVolume = 0.15; // Reduced master volume for better balance
        
        // Defer audio context creation until needed to avoid autoplay policy issues
        this.audioContext = null;
        this.channels = [];
        
        // Initialize with default register values
        this.resetRegisters();
    }
    
    // Reset audio registers to their default values
    resetRegisters() {
        // Channel 1 - Pulse with sweep
        this.memory[0xFF10] = 0x80; // NR10 - Sweep
        this.memory[0xFF11] = 0xBF; // NR11 - Length/Wave duty
        this.memory[0xFF12] = 0xF3; // NR12 - Envelope
        this.memory[0xFF13] = 0xFF; // NR13 - Frequency low
        this.memory[0xFF14] = 0xBF; // NR14 - Frequency high/Control
        
        // Channel 2 - Pulse
        this.memory[0xFF16] = 0x3F; // NR21 - Length/Wave duty
        this.memory[0xFF17] = 0x00; // NR22 - Envelope
        this.memory[0xFF18] = 0xFF; // NR23 - Frequency low
        this.memory[0xFF19] = 0xBF; // NR24 - Frequency high/Control
        
        // Channel 3 - Wave
        this.memory[0xFF1A] = 0x7F; // NR30 - Enable
        this.memory[0xFF1B] = 0xFF; // NR31 - Length
        this.memory[0xFF1C] = 0x9F; // NR32 - Output level
        this.memory[0xFF1D] = 0xFF; // NR33 - Frequency low
        this.memory[0xFF1E] = 0xBF; // NR34 - Frequency high/Control
        
        // Channel 4 - Noise
        this.memory[0xFF20] = 0xFF; // NR41 - Length
        this.memory[0xFF21] = 0x00; // NR42 - Envelope
        this.memory[0xFF22] = 0x00; // NR43 - Clock/Shift
        this.memory[0xFF23] = 0xBF; // NR44 - Control
        
        // Control
        this.memory[0xFF24] = 0x77; // NR50 - Master volume
        this.memory[0xFF25] = 0xF3; // NR51 - Sound panning
        this.memory[0xFF26] = 0xF1; // NR52 - Sound on/off
        
        // Initialize wave pattern RAM with default sine wave
        const wavePattern = [
            0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF,
            0xFE, 0xDC, 0xBA, 0x98, 0x76, 0x54, 0x32, 0x10
        ];
        
        for (let i = 0; i < 16; i++) {
            this.memory[0xFF30 + i] = wavePattern[i];
        }
    }

    // Initialize audio context and channels
    initialize() {
        if (this.audioInitialized) return;
        
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext({ latencyHint: 'interactive', sampleRate: 44100 });
            
            // Create a master gain node
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.masterVolume;
            
            // Create a compressor to handle audio dynamics better
            this.compressor = this.audioContext.createDynamicsCompressor();
            this.compressor.threshold.value = -15;
            this.compressor.knee.value = 10;
            this.compressor.ratio.value = 2;
            this.compressor.attack.value = 0.005;
            this.compressor.release.value = 0.05;
            
            // Connect master gain to compressor and then to output
            this.masterGain.connect(this.compressor);
            this.compressor.connect(this.audioContext.destination);
            
            // Create a low-pass filter to simulate the GB hardware
            this.lowPassFilter = this.audioContext.createBiquadFilter();
            this.lowPassFilter.type = 'lowpass';
            this.lowPassFilter.frequency.value = 4000; // Gameboy has limited frequency range
            this.masterGain.connect(this.lowPassFilter);
            this.lowPassFilter.connect(this.compressor);
            
            // Create channels
            this.channel1 = new Channel1(this, 1, this.audioContext);
            this.channel2 = new Channel2(this, 2, this.audioContext); // Separate class for Channel2
            this.channel3 = new Channel3(this, 3, this.audioContext);
            this.channel4 = new Channel4(this, 4, this.audioContext);
            
            // Store channels in array for easier management
            this.channels = [this.channel1, this.channel2, this.channel3, this.channel4];
            
            // Set up right panning for better stereo image
            const panningValues = [-0.3, 0.3, -0.1, 0.1]; // L, R, L, R for channels
            this.channels.forEach((channel, i) => {
                if (channel.panner) {
                    channel.panner.pan.value = panningValues[i];
                }
            });
            
            this.audioInitialized = true;
            console.log('Audio initialized successfully');
        } catch (e) {
            console.error('Failed to initialize audio:', e);
        }
    }

    connect() {
        if (!this.audioInitialized) {
            this.initialize();
        }
        
        // Resume audio context if it's suspended (due to autoplay policy)
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().then(() => {
                console.log('AudioContext resumed successfully');
            }).catch(err => {
                console.error('Failed to resume AudioContext:', err);
            });
        }
        
        this.enabled = true;
        this.channels.forEach(channel => channel.enable());
    }

    disconnect() {
        this.enabled = false;
        if (this.channels) {
            this.channels.forEach(channel => channel.disable());
        }
    }

    // Updates the states of each channel given the elapsed time
    // (in instructions) since last update
    update(clockElapsed) {
        if (!this.enabled || !this.audioInitialized) return;

        // Frame sequencer timing - 512Hz (every 8192 cycles at 4.194304MHz)
        this.frameSequencer = (this.frameSequencer || 0) + clockElapsed;
        
        if (this.frameSequencer >= 8192) {
            this.frameSequencer -= 8192;
            this.frameSequencerStep = (this.frameSequencerStep || 0) + 1;
            if (this.frameSequencerStep >= 8) this.frameSequencerStep = 0;
            
            // Process different operations at different steps
            const step = this.frameSequencerStep;
            
            // Length counter - Steps 0, 2, 4, 6
            if (step % 2 === 0) {
                this.channels.forEach(channel => {
                    if (channel.lengthCheck && channel.soundLength > 0) {
                        channel.soundLength--;
                        if (channel.soundLength <= 0) {
                            channel.stop();
                        }
                    }
                });
            }
            
            // Sweep - Steps 2, 6
            if (step === 2 || step === 6) {
                if (this.channel1 && this.channel1.sweepTime > 0) {
                    this.channel1.clockSweep++;
                    if (this.channel1.clockSweep >= this.channel1.sweepTime) {
                        this.channel1.clockSweep = 0;
                        
                        const newFreq = this.channel1.checkFreqSweep();
                        if (newFreq > 0) {
                            // Update the frequency in memory
                            this.memory[0xFF13] = newFreq & 0xFF;
                            this.memory[0xFF14] = (this.memory[0xFF14] & 0xF8) | ((newFreq & 0x700) >> 8);
                            
                            // Apply the new frequency
                            this.channel1.setFrequency(newFreq);
                            
                            // Check again with new value
                            this.channel1.checkFreqSweep();
                        }
                    }
                }
            }
            
            // Envelope - Step 7
            if (step === 7) {
                this.channels.forEach(channel => {
                    if (channel.envelopeCheck && channel.envelopeStep > 0) {
                        channel.envelopeTime = (channel.envelopeTime || 0) + 1;
                        if (channel.envelopeTime >= channel.envelopeStepLength) {
                            channel.envelopeTime = 0;
                            
                            // Update volume based on envelope direction
                            const newVolume = channel.envelopeVolume + channel.envelopeSign;
                            if (newVolume >= 0 && newVolume <= 15) {
                                channel.setEnvelopeVolume(newVolume);
                                channel.envelopeStep--;
                                if (channel.envelopeStep <= 0) {
                                    channel.envelopeCheck = false;
                                }
                            } else {
                                // Volume out of range, stop envelope
                                channel.envelopeCheck = false;
                            }
                        }
                    }
                });
            }
        }
        
        // Process each channel with the elapsed clock cycles for custom updates
        this.channels.forEach(channel => {
            if (channel && typeof channel.update === 'function') {
                channel.update(clockElapsed);
            }
        });
    }

    setSoundFlag(channel, value) {
        const mask = 0xFF - (1 << (channel - 1));
        value = value << (channel - 1);
        const byteValue = this.memory[APU.registers.NR52];
        const newValue = (byteValue & mask) | value;
        this.memory[APU.registers.NR52] = newValue;
    }

    // Manage writes to audio registers
    // Will update the channels depending on the address
    manageWrite(addr, value) {
        if (!this.audioInitialized && this.enabled) {
            this.initialize();
        }
        
        if (this.enabled == false && addr < APU.registers.NR52) {
            return;
        }
        
        this.memory[addr] = value;

        switch (addr) {
            // Channel 1 addresses
            case 0xFF10:
                if (this.channel1) {
                    this.channel1.clockSweep = 0;
                    this.channel1.sweepTime = ((value & 0x70) >> 4);
                    this.channel1.sweepSign = (value & 0x08) ? -1 : 1;
                    this.channel1.sweepShifts = (value & 0x07);
                    
                    if (this.channel1.sweepTime && this.channel1.sweepShifts) {
                        // Immediately calculate shadow frequency
                        this.channel1.shadowFrequency = this.channel1.getFrequency();
                        this.channel1.checkFreqSweep(); // Check if overflow would happen
                    }
                }
                break;
            case 0xFF11:
                // Wave duty and length
                if (this.channel1) {
                    const duty = (value & 0xC0) >> 6; // Bits 6-7 control duty cycle
                    this.channel1.setDutyCycle(duty);
                    this.channel1.setLength(value & 0x3F);
                }
                break;
            case 0xFF12:
                if (this.channel1) {
                    const startVolume = (value & 0xF0) >> 4;
                    this.channel1.envelopeSign = (value & 0x08) ? 1 : -1;
                    this.channel1.setEnvelopeVolume(startVolume);
                    this.channel1.envelopeStep = (value & 0x07);
                    
                    // Turn off channel if envelope and volume indicate dac off
                    if (startVolume === 0 && this.channel1.envelopeSign === -1) {
                        this.channel1.dacEnabled = false;
                        this.channel1.stop();
                    } else {
                        this.channel1.dacEnabled = true;
                    }
                }
                break;
            case 0xFF13:
                if (this.channel1) {
                    // Low 8 bits of frequency
                    const frequency = (this.channel1.getFrequency() & 0x700) | value;
                    this.channel1.setFrequency(frequency);
                    this.channel1.shadowFrequency = frequency;
                }
                break;
            case 0xFF14:
                if (this.channel1) {
                    // High bits of frequency + control
                    const frequency = (this.channel1.getFrequency() & 0xFF) | ((value & 7) << 8);
                    this.channel1.setFrequency(frequency);
                    this.channel1.shadowFrequency = frequency;
                    this.channel1.lengthCheck = (value & 0x40) ? true : false;
                    
                    // Trigger/restart sound
                    if (value & 0x80) {
                        // Only play if DAC is enabled
                        if (this.channel1.dacEnabled) {
                            this.channel1.play();
                        }
                    }
                }
                break;

            // Channel 2 addresses
            case 0xFF16:
                // Wave duty and length for channel 2
                if (this.channel2) {
                    const duty = (value & 0xC0) >> 6; // Bits 6-7 control duty cycle
                    this.channel2.setDutyCycle(duty);
                    this.channel2.setLength(value & 0x3F);
                }
                break;
            case 0xFF17:
                if (this.channel2) {
                    const startVolume = (value & 0xF0) >> 4;
                    this.channel2.envelopeSign = (value & 0x08) ? 1 : -1;
                    this.channel2.setEnvelopeVolume(startVolume);
                    this.channel2.envelopeStep = (value & 0x07);
                    
                    // Turn off channel if envelope and volume indicate dac off
                    if (startVolume === 0 && this.channel2.envelopeSign === -1) {
                        this.channel2.dacEnabled = false;
                        this.channel2.stop();
                    } else {
                        this.channel2.dacEnabled = true;
                    }
                }
                break;
            case 0xFF18:
                if (this.channel2) {
                    // Low 8 bits of frequency
                    const frequency = (this.channel2.getFrequency() & 0x700) | value;
                    this.channel2.setFrequency(frequency);
                }
                break;
            case 0xFF19:
                if (this.channel2) {
                    // High bits of frequency + control
                    const frequency = (this.channel2.getFrequency() & 0xFF) | ((value & 7) << 8);
                    this.channel2.setFrequency(frequency);
                    this.channel2.lengthCheck = (value & 0x40) ? true : false;
                    
                    // Trigger/restart sound
                    if (value & 0x80) {
                        // Only play if DAC is enabled
                        if (this.channel2.dacEnabled) {
                            this.channel2.play();
                        }
                    }
                }
                break;

            // Channel 3 addresses
            case 0xFF1A:
                if (this.channel3) {
                    // bit 7 enables/disables channel 3 DAC power
                    this.channel3.dacEnabled = !!(value & 0x80);
                    
                    if (!this.channel3.dacEnabled) {
                        this.channel3.stop();
                    } else if (this.memory[0xFF1E] & 0x80) {
                        // If DAC enabled and channel was triggered, restart
                        this.channel3.enable();
                    }
                }
                break;
            case 0xFF1B:
                if (this.channel3) {
                    this.channel3.setLength(value);
                }
                break;
            case 0xFF1C:
                if (this.channel3) {
                    // Volume control for channel 3 (bits 5-6)
                    const volumeCode = (value & 0x60) >> 5;
                    const volumes = [0, 1.0, 0.5, 0.25]; // 0%, 100%, 50%, 25%
                    this.channel3.setVolume(volumes[volumeCode]);
                }
                break;
            case 0xFF1D:
                if (this.channel3) {
                    const frequency = (this.channel3.getFrequency() & 0x700) | value;
                    this.channel3.setFrequency(frequency);
                }
                break;
            case 0xFF1E:
                if (this.channel3) {
                    const frequency = (this.channel3.getFrequency() & 0xFF) | ((value & 7) << 8);
                    this.channel3.setFrequency(frequency);
                    this.channel3.lengthCheck = (value & 0x40) ? true : false;
                    
                    if (value & 0x80) {
                        // Only play if DAC is enabled
                        if (this.channel3.dacEnabled) {
                            this.channel3.play();
                        }
                    }
                }
                break;

            // Channel 4 addresses
            case 0xFF20:
                if (this.channel4) {
                    this.channel4.setLength(value & 0x3F);
                }
                break;
            case 0xFF21:
                if (this.channel4) {
                    const startVolume = (value & 0xF0) >> 4;
                    this.channel4.envelopeSign = (value & 0x08) ? 1 : -1;
                    this.channel4.setEnvelopeVolume(startVolume);
                    this.channel4.envelopeStep = (value & 0x07);
                    
                    // Turn off channel if envelope and volume indicate dac off
                    if (startVolume === 0 && this.channel4.envelopeSign === -1) {
                        this.channel4.dacEnabled = false;
                        this.channel4.stop();
                    } else {
                        this.channel4.dacEnabled = true;
                    }
                }
                break;
            case 0xFF22:
                if (this.channel4) {
                    // Noise parameters
                    const shift = (value & 0xF0) >> 4;
                    const stepMode = (value & 0x08) ? 7 : 15; // 7 or 15 bit counter
                    const divRatio = value & 0x07;
                    this.channel4.setNoiseParameters(shift, stepMode, divRatio);
                }
                break;
            case 0xFF23:
                if (this.channel4) {
                    this.channel4.lengthCheck = (value & 0x40) ? true : false;
                    
                    if (value & 0x80) {
                        // Only play if DAC is enabled
                        if (this.channel4.dacEnabled) {
                            this.channel4.play();
                        }
                    }
                }
                break;

            // Sound control registers
            case 0xFF24:
                // Master volume control
                if (this.masterGain) {
                    const leftVolume = ((value & 0x70) >> 4) / 7;
                    const rightVolume = (value & 0x07) / 7;
                    
                    // Use the average for mono output or setup separate L/R outputs
                    const avgVolume = (leftVolume + rightVolume) / 2;
                    this.masterGain.gain.setValueAtTime(
                        avgVolume * this.masterVolume,
                        this.audioContext.currentTime
                    );
                }
                break;

            case 0xFF25:
                // Channel output control
                // Controls which channels go to which output terminals
                // We're using basic panning to simulate this
                if (this.channels) {
                    for (let i = 0; i < 4; i++) {
                        const channel = this.channels[i];
                        if (!channel || !channel.panner) continue;
                        
                        const leftEnabled = !!(value & (1 << i));
                        const rightEnabled = !!(value & (1 << (i + 4)));
                        
                        if (leftEnabled && rightEnabled) {
                            channel.panner.pan.value = 0; // Center
                        } else if (leftEnabled) {
                            channel.panner.pan.value = -0.8; // Left
                        } else if (rightEnabled) {
                            channel.panner.pan.value = 0.8; // Right
                        } else {
                            // If neither, we could mute but that's not accurate,
                            // as the channel would still be audible internally
                            channel.panner.pan.value = 0;
                            channel.gainNode.gain.value = 0;
                        }
                    }
                }
                break;

            // Channel 3 wave bytes
            case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33: case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37:
            case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B: case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
                if (this.channel3) {
                    const index = addr - 0xFF30;
                    this.channel3.setWaveBufferByte(index, value);
                }
                break;

            // General audio switch
            case 0xFF26:
                value &= 0xF0;
                this.memory[addr] = value;
                const newEnabled = (value & 0x80) != 0;
                
                if (newEnabled && !this.enabled) {
                    // Audio system switched on
                    this.enabled = true;
                    this.connect();
                } else if (!newEnabled && this.enabled) {
                    // Audio system switched off
                    this.enabled = false;
                    this.disconnect();
                    
                    // Reset all registers as specified by GB docs
                    this.resetRegisters();
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

// Base Channel class with common functionality
class Channel {
    constructor(apu, channelNumber, audioContext) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;
        this.dacEnabled = true;

        this.soundLength = 64;
        this.lengthCheck = false;

        this.envelopeVolume = 0;
        this.envelopeStep = 0;
        this.envelopeSign = 1;
        this.envelopeCheck = false;
        
        this.frequency = 0;

        this.audioContext = audioContext;
        
        if (audioContext) {
            // Create gain node for volume control
            this.gainNode = audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            // Create panner for channel positioning
            this.panner = audioContext.createStereoPanner();
            this.gainNode.connect(this.panner);
            
            // Connect to the master gain node
            if (apu.masterGain) {
                this.panner.connect(apu.masterGain);
            } else {
                this.panner.connect(audioContext.destination);
            }
        }
    }
    
    play() {
        // Base implementation
        if (this.playing || !this.audioContext || !this.dacEnabled) return;
        
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
    }
    
    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        // Mute the channel
        if (this.gainNode) {
            this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        }
    }
    
    update(clockElapsed) {
        // Base update - to be overridden by specific channels
    }
    
    setLength(value) {
        // Length value in GameBoy is (64 - t1), where t1 is the value in the register
        this.soundLength = 64 - (value & 0x3F);
    }
    
    setEnvelopeVolume(volume) {
        this.envelopeVolume = Math.min(Math.max(volume, 0), 15);
        this.envelopeCheck = this.envelopeVolume > 0 && this.envelopeVolume < 15 && this.envelopeStep > 0;
        
        if (this.gainNode) {
            // Apply a non-linear curve for more accurate GB sound
            const normalizedVolume = Math.pow(this.envelopeVolume / 15, 1.5) * 0.25;
            try {
                this.gainNode.gain.setValueAtTime(normalizedVolume, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to set gain:', e);
            }
        }
    }
    
    enable() {
        // Base enable method
    }
    
    disable() {
        if (this.gainNode) {
            this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        }
    }
}

// Channel 1 implementation (square wave with sweep)
export class Channel1 extends Channel {
    constructor(apu, channelNumber, audioContext) {
        super(apu, channelNumber, audioContext);

        this.sweepTime = 0;
        this.sweepShifts = 0;
        this.sweepSign = 1;
        this.clockSweep = 0;
        this.shadowFrequency = 0;
        
        this.dutyTable = [0.125, 0.25, 0.5, 0.75]; // The four duty cycles
        this.dutyRatio = this.dutyTable[2]; // Default 50% duty
        
        if (audioContext) {
            // Create oscillator for sound generation
            this.oscillator = audioContext.createOscillator();
            this.oscillator.type = 'square';
            this.oscillator.frequency.value = 440; // Start with A4
            
            // To get custom duty cycles, we need a wave table
            this.setupDutyOscillator(2); // Start with 50% duty
            
            this.oscillator.connect(this.gainNode);
            
            try {
                this.oscillator.start(0);
            } catch (e) {
                console.error('Failed to start oscillator:', e);
            }
        }
    }
    
    setupDutyOscillator(dutyIndex) {
        if (!this.audioContext) return;
        
        // Create a wave table for this duty cycle
        const duty = this.dutyTable[dutyIndex];
        const real = new Float32Array(2);
        const imag = new Float32Array(2);
        
        // First harmonic
        real[0] = 0;
        imag[0] = 0;
        
        // Second harmonic - adjusted for duty cycle
        real[1] = duty;
        imag[1] = 0;
        
        try {
            const wave = this.audioContext.createPeriodicWave(real, imag);
            this.oscillator.setPeriodicWave(wave);
        } catch (e) {
            console.error('Failed to set periodic wave:', e);
            // Fallback to square wave
            this.oscillator.type = 'square';
        }
    }

    play() {
        super.play();
        if (!this.playing) return;
        
        // Initialize sweep
        this.shadowFrequency = this.frequency;
        this.clockSweep = 0;
        
        // Reset envelope
        this.envelopeCheck = this.envelopeStep > 0;
        
        // Apply initial volume
        this.setEnvelopeVolume(this.envelopeVolume);
    }

    checkFreqSweep() {
        if (!this.playing || this.sweepShifts === 0) return 0;
        
        const newFreq = this.shadowFrequency + (this.sweepSign * (this.shadowFrequency >> this.sweepShifts));
        
        // Check for overflow (11-bit frequency limit)
        if (newFreq > 0x7FF) {
            this.stop();
            return 0;
        }
        
        // If no overflow and real calculation (not just a check), update shadow frequency
        this.shadowFrequency = newFreq;
        
        return newFreq;
    }

    update(clockElapsed) {
        // Specific updates for channel 1 beyond the frame sequencer updates
        // Nothing additional needed here, handled by frame sequencer now
    }

    setFrequency(value) {
        this.frequency = value & 0x7FF;
        
        if (this.oscillator) {
            // GameBoy frequency formula: 131072/(2048-x) Hz
            const frequencyHz = 131072 / (2048 - this.frequency);
            
            // Limit to audible range
            const safeFreq = Math.min(Math.max(frequencyHz, 20), 20000);
            
            try {
                this.oscillator.frequency.setValueAtTime(safeFreq, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to set frequency:', e);
            }
        }
    }

    getFrequency() {
        return this.frequency;
    }

    setDutyCycle(dutyCode) {
        dutyCode &= 0x3; // Ensure within range 0-3
        this.dutyRatio = this.dutyTable[dutyCode];
        
        if (this.oscillator) {
            this.setupDutyOscillator(dutyCode);
        }
    }

    enable() {
        super.enable();
        if (!this.playing || !this.dacEnabled) return;
        
        if (this.gainNode) {
            const normalizedVolume = Math.pow(this.envelopeVolume / 15, 1.5) * 0.25;
            this.gainNode.gain.setValueAtTime(normalizedVolume, this.audioContext.currentTime);
        }
    }
}

// Channel 2 implementation (square wave without sweep)
export class Channel2 extends Channel {
    constructor(apu, channelNumber, audioContext) {
        super(apu, channelNumber, audioContext);
        
        this.dutyTable = [0.125, 0.25, 0.5, 0.75]; // The four duty cycles
        this.dutyRatio = this.dutyTable[2]; // Default 50% duty
        
        if (audioContext) {
            // Create oscillator for sound generation
            this.oscillator = audioContext.createOscillator();
            this.oscillator.type = 'square';
            this.oscillator.frequency.value = 440; // Start with A4
            
            // To get custom duty cycles, we need a wave table
            this.setupDutyOscillator(2); // Start with 50% duty
            
            this.oscillator.connect(this.gainNode);
            
            try {
                this.oscillator.start(0);
            } catch (e) {
                console.error('Failed to start oscillator:', e);
            }
        }
    }
    
    setupDutyOscillator(dutyIndex) {
        if (!this.audioContext) return;
        
        // Create a wave table for this duty cycle
        const duty = this.dutyTable[dutyIndex];
        const real = new Float32Array(2);
        const imag = new Float32Array(2);
        
        // First harmonic
        real[0] = 0;
        imag[0] = 0;
        
        // Second harmonic - adjusted for duty cycle
        real[1] = duty;
        imag[1] = 0;
        
        try {
            const wave = this.audioContext.createPeriodicWave(real, imag);
            this.oscillator.setPeriodicWave(wave);
        } catch (e) {
            console.error('Failed to set periodic wave:', e);
            // Fallback to square wave
            this.oscillator.type = 'square';
        }
    }

    play() {
        super.play();
        if (!this.playing) return;
        
        // Reset envelope
        this.envelopeCheck = this.envelopeStep > 0;
        
        // Apply initial volume
        this.setEnvelopeVolume(this.envelopeVolume);
    }

    setFrequency(value) {
        this.frequency = value & 0x7FF;
        
        if (this.oscillator) {
            // GameBoy frequency formula: 131072/(2048-x) Hz
            const frequencyHz = 131072 / (2048 - this.frequency);
            
            // Limit to audible range
            const safeFreq = Math.min(Math.max(frequencyHz, 20), 20000);
            
            try {
                this.oscillator.frequency.setValueAtTime(safeFreq, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to set frequency:', e);
            }
        }
    }

    getFrequency() {
        return this.frequency;
    }

    setDutyCycle(dutyCode) {
        dutyCode &= 0x3; // Ensure within range 0-3
        this.dutyRatio = this.dutyTable[dutyCode];
        
        if (this.oscillator) {
            this.setupDutyOscillator(dutyCode);
        }
    }

    enable() {
        super.enable();
        if (!this.playing || !this.dacEnabled) return;
        
        if (this.gainNode) {
            const normalizedVolume = Math.pow(this.envelopeVolume / 15, 1.5) * 0.25;
            this.gainNode.gain.setValueAtTime(normalizedVolume, this.audioContext.currentTime);
        }
    }
}

// Channel 3 implementation (wave form)
export class Channel3 extends Channel {
    constructor(apu, channelNumber, audioContext) {
        super(apu, channelNumber, audioContext);

        this.soundLength = 0;
        this.volume = 0;
        this.dacEnabled = false;
        
        // Create a 32-sample buffer for the wave pattern (4-bit samples)
        this.waveBuffer = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            this.waveBuffer[i] = 0;
        }

        if (audioContext) {
            // Create oscillator with custom wave
            this.oscillator = audioContext.createOscillator();
            
            // Initialize with a simple sine wave
            this.updateWaveTable();
            
            this.oscillator.connect(this.gainNode);
            
            try {
                this.oscillator.start(0);
            } catch (e) {
                console.error('Failed to start oscillator:', e);
            }
        }
    }

    play() {
        super.play();
        if (!this.playing) return;
        
        // Update the wave table before playing
        this.updateWaveTable();
        
        // Set the volume
        if (this.gainNode) {
            this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
        }
    }

    updateWaveTable() {
        if (!this.audioContext || !this.oscillator) return;
        
        try {
            // Create a wave table from the wave buffer
            const real = new Float32Array(33);
            const imag = new Float32Array(33);
            
            // DC offset
            real[0] = 0;
            imag[0] = 0;
            
            // Fill with harmonics from the wave buffer
            for (let i = 1; i < 33; i++) {
                // Use more precise wave shape
                const harmonic = i - 1;
                real[i] = this.waveBuffer[harmonic] || 0;
                imag[i] = 0; // Only using cosine terms
            }
            
            const wave = this.audioContext.createPeriodicWave(real, imag, { disableNormalization: true });
            this.oscillator.setPeriodicWave(wave);
        } catch (e) {
            console.error('Failed to update wave table:', e);
        }
    }

    setFrequency(value) {
        this.frequency = value & 0x7FF;
        
        if (this.oscillator) {
            // GameBoy frequency formula for Channel 3: 65536/(2048-x) Hz
            const frequencyHz = 65536 / (2048 - this.frequency);
            
            // Limit to audible range
            const safeFreq = Math.min(Math.max(frequencyHz, 20), 20000);
            
            try {
                this.oscillator.frequency.setValueAtTime(safeFreq, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to set frequency:', e);
            }
        }
    }

    getFrequency() {
        return this.frequency;
    }

    setLength(value) {
        // For channel 3, length is 256 - value
        this.soundLength = 256 - (value & 0xFF);
    }

    setVolume(volumeLevel) {
        this.volume = volumeLevel * 0.2; // Scale down for better balance
        
        if (this.gainNode && this.playing) {
            this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
        }
    }

    setWaveBufferByte(index, value) {
        // Each byte contains two 4-bit samples
        const bufferIndex = index * 2;
        
        // Convert 4-bit values to normalized float (-1 to 1)
        this.waveBuffer[bufferIndex] = ((value >> 4) & 0x0F) / 7.5 - 1;
        this.waveBuffer[bufferIndex + 1] = (value & 0x0F) / 7.5 - 1;
        
        // Update the wave table if we're playing
        if (this.playing) {
            this.updateWaveTable();
        }
    }

    enable() {
        super.enable();
        if (!this.playing || !this.dacEnabled) return;
        
        if (this.gainNode) {
            this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
        }
    }
}

// Channel 4 implementation (noise)
export class Channel4 extends Channel {
    constructor(apu, channelNumber, audioContext) {
        super(apu, channelNumber, audioContext);

        // Noise parameters
        this.shiftClock = 0;
        this.stepMode = 15; // 15-bit or 7-bit LFSR
        this.divRatio = 0;
        
        // LFSR state
        this.lfsr = 0x7FFF; // 15-bit initial value
        
        if (audioContext) {
            // Create noise buffer using AudioWorklet if supported
            this.setupNoiseGenerator();
        }
    }
    
    setupNoiseGenerator() {
        if (!this.audioContext) return;
        
        try {
            // Create a buffer of noise
            const bufferSize = this.audioContext.sampleRate;
            const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            
            // Fill with white noise
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }
            
            // Create a buffer source and loop it
            this.noiseSource = this.audioContext.createBufferSource();
            this.noiseSource.buffer = noiseBuffer;
            this.noiseSource.loop = true;
            
            // Create a filter to shape the noise
            this.filter = this.audioContext.createBiquadFilter();
            this.filter.type = 'lowpass';
            this.filter.frequency.value = 1000; // Default cutoff
            
            // Connect the chain
            this.noiseSource.connect(this.filter);
            this.filter.connect(this.gainNode);
            
            try {
                this.noiseSource.start(0);
            } catch (e) {
                console.error('Failed to start noise source:', e);
            }
        } catch (e) {
            console.error('Failed to setup noise generator:', e);
        }
    }

    play() {
        super.play();
        if (!this.playing) return;
        
        // Reset LFSR
        this.lfsr = 0x7FFF;
        
        // Reset envelope
        this.envelopeCheck = this.envelopeStep > 0;
        
        // Apply initial volume
        this.setEnvelopeVolume(this.envelopeVolume);
    }

    setNoiseParameters(shift, width, ratio) {
        this.shiftClock = shift;
        this.stepMode = width;
        this.divRatio = ratio;
        
        if (this.filter) {
            // Adjust filter based on noise parameters
            // Higher shift = higher frequency cutoff
            const r = ratio === 0 ? 0.5 : ratio;
            const baseFreq = 524288 / (r * 16); // Simplified from GB formula
            const shiftedFreq = baseFreq / Math.pow(2, shift);
            
            // Limit to audio range
            const cutoff = Math.min(Math.max(shiftedFreq, 200), 8000);
            
            try {
                this.filter.frequency.setValueAtTime(cutoff, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to set noise filter:', e);
            }
            
            // Set playback rate to affect noise "pitch"
            if (this.noiseSource && this.noiseSource.playbackRate) {
                const rate = Math.min(Math.max(shiftedFreq / 1000, 0.1), 4.0);
                this.noiseSource.playbackRate.setValueAtTime(rate, this.audioContext.currentTime);
            }
        }
    }

    enable() {
        super.enable();
        if (!this.playing || !this.dacEnabled) return;
        
        if (this.gainNode && this.envelopeVolume > 0) {
            const normalizedVolume = Math.pow(this.envelopeVolume / 15, 1.5) * 0.15;
            this.gainNode.gain.setValueAtTime(normalizedVolume, this.audioContext.currentTime);
        }
    }
}