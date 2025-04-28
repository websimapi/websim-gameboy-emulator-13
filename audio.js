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
        this.masterVolume = 0.2; // Add master volume control
        
        // Defer audio context creation until needed to avoid autoplay policy issues
        this.audioContext = null;
        this.channels = [];
    }

    // Initialize audio context and channels
    initialize() {
        if (this.audioInitialized) return;
        
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            // Create a master gain node
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.masterVolume;
            this.masterGain.connect(this.audioContext.destination);
            
            // Create channels
            this.channel1 = new Channel1(this, 1, this.audioContext);
            this.channel2 = new Channel1(this, 2, this.audioContext); // Channel2 is similar to Channel1
            this.channel3 = new Channel3(this, 3, this.audioContext);
            this.channel4 = new Channel4(this, 4, this.audioContext);
            
            // Store channels in array for easier management
            this.channels = [this.channel1, this.channel2, this.channel3, this.channel4];
            
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

        // Process each channel with the elapsed clock cycles
        this.channels.forEach(channel => {
            if (channel && typeof channel.update === 'function') {
                channel.update(clockElapsed);
            }
        });
    }

    setSoundFlag(channel, value) {
        const mask = 0xFF - (1 << (channel - 1));
        value = value << (channel - 1);
        const byteValue = this.memory.rb(APU.registers.NR52);
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
                    this.channel1.sweepCount = this.channel1.sweepShifts;
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
                    this.channel1.envelopeSign = (value & 0x08) ? 1 : -1;
                    const envelopeVolume = (value & 0xF0) >> 4;
                    this.channel1.setEnvelopeVolume(envelopeVolume);
                    this.channel1.envelopeStep = (value & 0x07);
                }
                break;
            case 0xFF13:
                if (this.channel1) {
                    let frequency = this.channel1.getFrequency();
                    frequency &= 0xF00;
                    frequency |= value;
                    this.channel1.setFrequency(frequency);
                }
                break;
            case 0xFF14:
                if (this.channel1) {
                    let frequency = this.channel1.getFrequency();
                    frequency &= 0xFF;
                    frequency |= (value & 7) << 8;
                    this.channel1.setFrequency(frequency);
                    this.channel1.lengthCheck = (value & 0x40) ? true : false;
                    if (value & 0x80) this.channel1.play();
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
                    this.channel2.envelopeSign = (value & 0x08) ? 1 : -1;
                    const envelopeVolume = (value & 0xF0) >> 4;
                    this.channel2.setEnvelopeVolume(envelopeVolume);
                    this.channel2.envelopeStep = (value & 0x07);
                }
                break;
            case 0xFF18:
                if (this.channel2) {
                    let frequency = this.channel2.getFrequency();
                    frequency &= 0xF00;
                    frequency |= value;
                    this.channel2.setFrequency(frequency);
                }
                break;
            case 0xFF19:
                if (this.channel2) {
                    let frequency = this.channel2.getFrequency();
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
            case 0xFF1A:
                if (this.channel3) {
                    // bit 7 enables/disables channel 3
                    if (value & 0x80) {
                        this.channel3.enable();
                    } else {
                        this.channel3.disable();
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
                    let frequency = this.channel3.getFrequency();
                    frequency &= 0xF00;
                    frequency |= value;
                    this.channel3.setFrequency(frequency);
                }
                break;
            case 0xFF1E:
                if (this.channel3) {
                    let frequency = this.channel3.getFrequency();
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
            case 0xFF20:
                if (this.channel4) {
                    this.channel4.setLength(value & 0x3F);
                }
                break;
            case 0xFF21:
                if (this.channel4) {
                    this.channel4.envelopeSign = (value & 0x08) ? 1 : -1;
                    const envelopeVolume = (value & 0xF0) >> 4;
                    this.channel4.setEnvelopeVolume(envelopeVolume);
                    this.channel4.envelopeStep = (value & 0x07);
                }
                break;
            case 0xFF22:
                if (this.channel4) {
                    // Noise parameters
                    const shift = (value & 0xF0) >> 4;
                    const width = (value & 0x08) ? 7 : 15; // 7 or 15 bit counter
                    const ratio = value & 0x07;
                    this.channel4.setNoiseParameters(shift, width, ratio);
                }
                break;
            case 0xFF23:
                if (this.channel4) {
                    this.channel4.lengthCheck = (value & 0x40) ? true : false;
                    if (value & 0x80) {
                        this.channel4.play();
                    }
                }
                break;

            // Sound control registers
            case 0xFF24:
                // Master volume control
                if (this.masterGain) {
                    const leftVolume = ((value & 0x70) >> 4) / 7;
                    const rightVolume = (value & 0x07) / 7;
                    // Use the average for mono output
                    this.masterGain.gain.value = this.masterVolume * ((leftVolume + rightVolume) / 2);
                }
                break;

            case 0xFF25:
                // Channel output control
                // Controls which channels go to which output terminals
                // We're using mono output, so we don't need to implement this fully
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
                    for (let i = 0xFF10; i < 0xFF26; i++) {
                        this.memory[i] = 0;
                    }
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
        this.dutyRatio = 0.5; // Default duty cycle (50%)

        this.envelopeStep = 0;
        this.envelopeStepLength = 0x10000;// 1 / 64 seconds of instructions
        this.envelopeCheck = false;
        this.envelopeSign = 1;
        this.envelopeVolume = 0;

        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;

        this.audioContext = audioContext;
        
        // Only create audio nodes if we have a valid audio context
        if (audioContext) {
            // Create gain node for volume control
            this.gainNode = audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            // Create oscillator for sound generation
            this.oscillator = audioContext.createOscillator();
            this.oscillator.type = 'square';
            this.oscillator.frequency.value = 440; // Start with a reasonable frequency
            this.oscillator.connect(this.gainNode);
            
            // Connect to the master gain node if available
            if (apu.masterGain) {
                this.gainNode.connect(apu.masterGain);
            } else {
                this.gainNode.connect(audioContext.destination);
            }
            
            try {
                this.oscillator.start(0);
            } catch (e) {
                console.error('Failed to start oscillator:', e);
            }
        }
    }

    play() {
        if (this.playing || !this.audioContext) return;
        
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Reconnect if needed
        this.enable();
        
        // Reset clocks
        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;
        
        // Apply initial envelope volume
        this.setEnvelopeVolume(this.envelopeVolume);
        
        // Check sweep frequency if needed
        if (this.sweepShifts > 0 && this.sweepTime > 0) {
            this.checkFreqSweep();
        }
    }

    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        // Mute the channel without disconnecting
        if (this.gainNode) {
            this.gainNode.gain.value = 0;
        }
    }

    checkFreqSweep() {
        if (!this.playing) return 0;
        
        const oldFreq = this.getFrequency();
        const newFreq = oldFreq + this.sweepSign * (oldFreq >> this.sweepShifts);
        
        if (newFreq > 0x7FF) {
            this.stop();
            return 0;
        }

        return newFreq;
    }

    update(clockElapsed) {
        if (!this.playing) return;

        // Envelope processing
        if (this.envelopeStep > 0 && this.envelopeCheck) {
            this.clockEnvelop += clockElapsed;
            if (this.clockEnvelop >= this.envelopeStepLength) {
                this.clockEnvelop -= this.envelopeStepLength;
                
                // Update volume based on envelope direction
                const newVolume = this.envelopeVolume + this.envelopeSign;
                if (newVolume >= 0 && newVolume <= 15) {
                    this.setEnvelopeVolume(newVolume);
                    this.envelopeStep--;
                    if (this.envelopeStep <= 0) {
                        this.envelopeCheck = false;
                    }
                } else {
                    // Volume out of range, stop envelope
                    this.envelopeCheck = false;
                }
            }
        }

        // Sweep processing
        if (this.sweepTime > 0 && this.sweepShifts > 0) {
            this.clockSweep += clockElapsed;
            if (this.clockSweep >= (this.sweepStepLength * this.sweepTime)) {
                this.clockSweep -= (this.sweepStepLength * this.sweepTime);
                
                const newFreq = this.checkFreqSweep();
                if (newFreq > 0) {
                    // Update the frequency in memory
                    this.apu.memory[0xFF13] = newFreq & 0xFF;
                    this.apu.memory[0xFF14] &= 0xF8;
                    this.apu.memory[0xFF14] |= (newFreq & 0x700) >> 8;
                    
                    // Apply the new frequency
                    this.setFrequency(newFreq);
                    
                    // Check again with new value
                    this.checkFreqSweep();
                }
            }
        }

        // Length counter processing
        if (this.lengthCheck && this.soundLength > 0) {
            this.clockLength += clockElapsed;
            if (this.clockLength >= this.soundLengthUnit) {
                this.clockLength -= this.soundLengthUnit;
                this.soundLength--;
                if (this.soundLength <= 0) {
                    this.setLength(0);
                    this.stop();
                }
            }
        }
    }

    setFrequency(value) {
        this.frequency = value;
        if (this.oscillator) {
            // GameBoy frequency formula: 131072/(2048-x) Hz
            const frequencyHz = 131072 / (2048 - (this.frequency & 0x7FF));
            
            // Limit to avoid extreme frequencies
            const safeFreq = Math.min(Math.max(frequencyHz, 20), 20000);
            
            try {
                this.oscillator.frequency.setValueAtTime(safeFreq, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to set frequency:', e);
            }
        }
    }

    getFrequency() {
        return this.frequency & 0x7FF;
    }

    setLength(value) {
        // Length value in GameBoy is (64 - t1), where t1 is the value in the register
        this.soundLength = 64 - (value & 0x3F);
    }

    setEnvelopeVolume(volume) {
        this.envelopeVolume = Math.min(Math.max(volume, 0), 15);
        this.envelopeCheck = this.envelopeVolume > 0 && this.envelopeVolume < 15 && this.envelopeStep > 0;
        
        if (this.gainNode) {
            // Scale from 0-15 to 0-1 range, with a non-linear curve for better sound
            const normalizedVolume = Math.pow(this.envelopeVolume / 15, 1.5) * 0.15;
            try {
                this.gainNode.gain.setValueAtTime(normalizedVolume, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to set gain:', e);
            }
        }
    }

    setDutyCycle(dutyCode) {
        // GameBoy has 4 duty cycles: 12.5%, 25%, 50%, 75%
        const dutyCycles = [0.125, 0.25, 0.5, 0.75];
        this.dutyRatio = dutyCycles[dutyCode & 0x3];
        
        // Web Audio API doesn't support custom duty cycles for OscillatorNode
        // We're using 'square' which is fixed at 50% duty cycle
        // For proper implementation, we would need to use a custom periodic wave
    }

    disable() {
        if (this.gainNode) {
            try {
                this.gainNode.gain.value = 0;
            } catch (e) {
                console.error('Failed to disable gain:', e);
            }
        }
    }

    enable() {
        if (!this.playing) return;
        
        if (this.gainNode && this.envelopeVolume > 0) {
            const normalizedVolume = Math.pow(this.envelopeVolume / 15, 1.5) * 0.15;
            try {
                this.gainNode.gain.setValueAtTime(normalizedVolume, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to enable gain:', e);
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

        this.soundLength = 0;
        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.lengthCheck = false;

        this.clockLength = 0;
        this.volume = 0;
        this.frequency = 0;

        // Create a 32-sample buffer for the wave pattern (4-bit samples)
        this.buffer = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            this.buffer[i] = 0;
        }

        this.audioContext = audioContext;
        
        // Only create audio nodes if we have a valid audio context
        if (audioContext) {
            // Create gain node for volume control
            this.gainNode = audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            // Create wave buffer at a reasonable sample rate
            this.baseSpeed = 32768; // Sample rate for the wave buffer
            this.waveBuffer = audioContext.createBuffer(1, 32, this.baseSpeed);
            
            // Create audio source from the wave buffer
            this.bufferSource = audioContext.createBufferSource();
            this.bufferSource.buffer = this.waveBuffer;
            this.bufferSource.loop = true;
            this.bufferSource.connect(this.gainNode);
            
            // Connect to the master gain node if available
            if (apu.masterGain) {
                this.gainNode.connect(apu.masterGain);
            } else {
                this.gainNode.connect(audioContext.destination);
            }
            
            try {
                this.bufferSource.start(0);
            } catch (e) {
                console.error('Failed to start buffer source:', e);
            }
            
            // Update the wave buffer with initial data
            this.updateWaveBuffer();
        }
    }

    play() {
        if (this.playing || !this.audioContext) return;
        
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Update wave buffer before playing
        this.updateWaveBuffer();
        
        // Apply volume
        if (this.gainNode) {
            this.gainNode.gain.value = this.volume;
        }
        
        this.clockLength = 0;
    }

    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        if (this.gainNode) {
            this.gainNode.gain.value = 0;
        }
    }

    update(clockElapsed) {
        if (!this.playing) return;
        
        // Length counter processing
        if (this.lengthCheck && this.soundLength > 0) {
            this.clockLength += clockElapsed;
            if (this.clockLength >= this.soundLengthUnit) {
                this.clockLength -= this.soundLengthUnit;
                this.soundLength--;
                if (this.soundLength <= 0) {
                    this.setLength(0);
                    this.stop();
                }
            }
        }
    }

    updateWaveBuffer() {
        if (!this.waveBuffer || !this.audioContext) return;
        
        try {
            // Copy current buffer data to the audio buffer
            this.waveBuffer.copyToChannel(this.buffer, 0);
        } catch (e) {
            console.error('Failed to update wave buffer:', e);
        }
    }

    setFrequency(value) {
        this.frequency = value & 0x7FF;
        
        if (this.bufferSource) {
            // GameBoy frequency formula for Channel 3: 65536/(2048-x) Hz
            const frequencyHz = 65536 / (2048 - this.frequency);
            
            // Calculate playback rate to achieve the desired frequency
            const rate = frequencyHz / (this.baseSpeed / 32);
            
            try {
                this.bufferSource.playbackRate.setValueAtTime(rate, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to set playback rate:', e);
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
        this.volume = volumeLevel * 0.15; // Scale down for overall balance
        
        if (this.gainNode && this.playing) {
            try {
                this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to set channel 3 gain:', e);
            }
        }
    }

    setWaveBufferByte(index, value) {
        // Each byte contains two 4-bit samples
        const bufferIndex = index * 2;
        
        // High nibble (first sample)
        this.buffer[bufferIndex] = ((value >> 4) & 0x0F) / 7.5 - 1; // Scale to -1 to 1 range
        
        // Low nibble (second sample)
        this.buffer[bufferIndex + 1] = (value & 0x0F) / 7.5 - 1;
        
        // Update the wave buffer if we're currently playing
        if (this.playing) {
            this.updateWaveBuffer();
        }
    }

    disable() {
        if (this.gainNode) {
            try {
                this.gainNode.gain.value = 0;
            } catch (e) {
                console.error('Failed to disable channel 3:', e);
            }
        }
    }

    enable() {
        if (this.gainNode && this.playing) {
            try {
                this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to enable channel 3:', e);
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

        this.envelopeStep = 0;
        this.envelopeStepLength = 0x10000; // 1 / 64 seconds of instructions
        this.envelopeCheck = false;
        this.envelopeSign = 1;
        this.envelopeVolume = 0;

        this.clockLength = 0;
        this.clockEnvelop = 0;
        
        // Noise parameters
        this.shiftClock = 0;
        this.widthMode = 0;
        this.divisorRatio = 0;

        this.audioContext = audioContext;
        
        // Only create audio nodes if we have a valid audio context
        if (audioContext) {
            // Create gain node for volume control
            this.gainNode = audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            // Create noise generator using white noise
            this.noiseNode = audioContext.createBufferSource();
            
            // Create noise buffer
            const bufferSize = audioContext.sampleRate * 2; // 2 seconds of noise
            const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            
            // Fill with white noise
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }
            
            this.noiseNode.buffer = noiseBuffer;
            this.noiseNode.loop = true;
            this.noiseNode.connect(this.gainNode);
            
            // Create a filter to shape the noise
            this.filter = audioContext.createBiquadFilter();
            this.filter.type = 'lowpass';
            this.filter.frequency.value = 1000; // Default cutoff
            this.gainNode.connect(this.filter);
            
            // Connect to the master gain node if available
            if (apu.masterGain) {
                this.filter.connect(apu.masterGain);
            } else {
                this.filter.connect(audioContext.destination);
            }
            
            try {
                this.noiseNode.start(0);
            } catch (e) {
                console.error('Failed to start noise node:', e);
            }
        }
    }

    play() {
        if (this.playing || !this.audioContext) return;
        
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Apply initial envelope volume
        this.setEnvelopeVolume(this.envelopeVolume);
        
        this.clockLength = 0;
        this.clockEnvelop = 0;
    }

    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        if (this.gainNode) {
            this.gainNode.gain.value = 0;
        }
    }

    update(clockElapsed) {
        if (!this.playing) return;
        
        // Envelope processing
        if (this.envelopeStep > 0 && this.envelopeCheck) {
            this.clockEnvelop += clockElapsed;
            if (this.clockEnvelop >= this.envelopeStepLength) {
                this.clockEnvelop -= this.envelopeStepLength;
                
                // Update volume based on envelope direction
                const newVolume = this.envelopeVolume + this.envelopeSign;
                if (newVolume >= 0 && newVolume <= 15) {
                    this.setEnvelopeVolume(newVolume);
                    this.envelopeStep--;
                    if (this.envelopeStep <= 0) {
                        this.envelopeCheck = false;
                    }
                } else {
                    // Volume out of range, stop envelope
                    this.envelopeCheck = false;
                }
            }
        }
        
        // Length counter processing
        if (this.lengthCheck && this.soundLength > 0) {
            this.clockLength += clockElapsed;
            if (this.clockLength >= this.soundLengthUnit) {
                this.clockLength -= this.soundLengthUnit;
                this.soundLength--;
                if (this.soundLength <= 0) {
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
        this.envelopeVolume = Math.min(Math.max(volume, 0), 15);
        this.envelopeCheck = this.envelopeVolume > 0 && this.envelopeVolume < 15 && this.envelopeStep > 0;
        
        if (this.gainNode) {
            // Scale from 0-15 to 0-1 range, with a non-linear curve for better sound
            const normalizedVolume = Math.pow(this.envelopeVolume / 15, 1.5) * 0.1; // Noise is quieter
            try {
                this.gainNode.gain.setValueAtTime(normalizedVolume, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to set noise gain:', e);
            }
        }
    }

    setNoiseParameters(shift, width, ratio) {
        this.shiftClock = shift;
        this.widthMode = width;
        this.divisorRatio = ratio;
        
        if (this.filter) {
            // Adjust filter based on noise parameters
            // Higher shift = higher frequency cutoff
            const divisor = ratio == 0 ? 8 : ratio * 16;
            const baseFreq = 524288 / divisor;
            const shiftedFreq = baseFreq / Math.pow(2, shift);
            
            // Limit to audio range
            const cutoff = Math.min(Math.max(shiftedFreq, 100), 8000);
            
            try {
                this.filter.frequency.setValueAtTime(cutoff, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to set noise filter:', e);
            }
        }
    }

    disable() {
        if (this.gainNode) {
            try {
                this.gainNode.gain.value = 0;
            } catch (e) {
                console.error('Failed to disable noise channel:', e);
            }
        }
    }

    enable() {
        if (!this.playing) return;
        
        if (this.gainNode && this.envelopeVolume > 0) {
            const normalizedVolume = Math.pow(this.envelopeVolume / 15, 1.5) * 0.1;
            try {
                this.gainNode.gain.setValueAtTime(normalizedVolume, this.audioContext.currentTime);
            } catch (e) {
                console.error('Failed to enable noise channel:', e);
            }
        }
    }
}