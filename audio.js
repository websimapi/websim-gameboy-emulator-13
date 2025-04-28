// audio.js - Improved Audio Processing Unit implementation

import { Util } from './utils.js';

// Audio Processing unit
// Listens the write accesses to the audio-reserved memory addresses
// and dispatches the data to the sound channels
export class APU {
    constructor(memory) {
        this.memory = memory;
        this.enabled = false;
        this.audioReady = false;
        this.sampleRate = 44100;
        this.samplesPerFrame = this.sampleRate / 60;
        this.audioBuffer = [];
        this.bufferSize = 2048; // Optimal buffer size for performance
        this.lastTime = 0;
        
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            this.setupAudioProcessor();
        } catch (e) {
            console.error("Web Audio API is not supported in this browser");
        }

        this.channel1 = new Channel1(this, 1, this.audioContext);
        this.channel2 = new Channel1(this, 2, this.audioContext);
        this.channel3 = new Channel3(this, 3, this.audioContext);
        this.channel4 = new Channel4(this, 4, this.audioContext);
        
        // Mixer node to combine all channels
        this.mixerNode = this.audioContext && this.audioContext.createGain();
        if (this.mixerNode) {
            this.mixerNode.gain.value = 0.25; // Reduce overall volume
            this.mixerNode.connect(this.audioContext.destination);
        }
    }
    
    setupAudioProcessor() {
        if (!this.audioContext) return;
        
        // Use AudioWorklet or ScriptProcessorNode based on browser support
        if (this.audioContext.audioWorklet) {
            // Modern approach with AudioWorklet
            const workletCode = `
                class GameboyAudioProcessor extends AudioWorkletProcessor {
                    constructor() {
                        super();
                        this.buffer = [];
                        this.port.onmessage = (e) => {
                            if (e.data.buffer) {
                                this.buffer = this.buffer.concat(e.data.buffer);
                            }
                        };
                    }
                    
                    process(inputs, outputs, parameters) {
                        const output = outputs[0][0];
                        for (let i = 0; i < output.length; i++) {
                            output[i] = this.buffer.shift() || 0;
                        }
                        return true;
                    }
                }
                registerProcessor('gameboy-audio-processor', GameboyAudioProcessor);
            `;
            
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const workletUrl = URL.createObjectURL(blob);
            
            this.audioContext.audioWorklet.addModule(workletUrl).then(() => {
                this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'gameboy-audio-processor');
                this.audioWorkletNode.connect(this.mixerNode);
                this.audioReady = true;
            }).catch(err => {
                console.error("AudioWorklet error:", err);
                this.setupScriptProcessor(); // Fallback
            });
        } else {
            this.setupScriptProcessor();
        }
    }
    
    setupScriptProcessor() {
        // Fallback to ScriptProcessorNode
        this.scriptProcessor = this.audioContext.createScriptProcessor(this.bufferSize, 0, 1);
        this.scriptProcessor.onaudioprocess = (e) => {
            const output = e.outputBuffer.getChannelData(0);
            for (let i = 0; i < output.length; i++) {
                output[i] = this.audioBuffer.shift() || 0;
            }
        };
        this.scriptProcessor.connect(this.mixerNode);
        this.audioReady = true;
    }

    connect() {
        if (!this.audioContext) return;
        
        if (this.audioContext.state === "suspended") {
            this.audioContext.resume();
        }
        
        this.channel1.enable();
        this.channel2.enable();
        this.channel3.enable();
        this.channel4.enable();
        this.enabled = true;
    }

    disconnect() {
        this.channel1.disable();
        this.channel2.disable();
        this.channel3.disable();
        this.channel4.disable();
        this.enabled = false;
    }

    // Updates the states of each channel given the elapsed time
    // This method is called from the main emulation loop
    update(clockElapsed) {
        if (!this.enabled || !this.audioReady) return;

        // Update channel states based on emulator clock
        this.channel1.update(clockElapsed);
        this.channel2.update(clockElapsed);
        this.channel3.update(clockElapsed);
        this.channel4.update(clockElapsed);
        
        // Generate audio samples at regular intervals
        this.lastTime += clockElapsed;
        const samplesNeeded = Math.floor(this.lastTime / 87); // ~4194304Hz CPU clock / 48000Hz sample rate
        
        if (samplesNeeded > 0) {
            this.lastTime %= 87;
            
            // Generate samples from all channels
            for (let i = 0; i < samplesNeeded; i++) {
                // Mix all channels together
                let sample = 0;
                if (this.channel1.playing) sample += this.channel1.getSample();
                if (this.channel2.playing) sample += this.channel2.getSample();
                if (this.channel3.playing) sample += this.channel3.getSample();
                if (this.channel4.playing) sample += this.channel4.getSample();
                
                // Normalize sample and add to buffer
                sample = Math.max(-1, Math.min(1, sample));
                this.audioBuffer.push(sample);
            }
            
            // Send buffer to AudioWorklet if available
            if (this.audioWorkletNode) {
                const bufferToSend = this.audioBuffer.splice(0, this.bufferSize);
                if (bufferToSend.length > 0) {
                    this.audioWorkletNode.port.postMessage({ buffer: bufferToSend });
                }
            }
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
                    this.disconnect();
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
        
        // Channel state
        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.soundLength = 64; // defaults to 64 periods
        this.lengthCheck = false;
        this.frequency = 0;
        this.volume = 0;
        this.dutyCycle = 0.5; // Duty cycle (square wave ratio)
        
        // Sweep parameters
        this.sweepTime = 0; // from 0 to 7
        this.sweepStepLength = 0x8000; // 1 / 128 seconds of instructions
        this.sweepCount = 0;
        this.sweepShifts = 0;
        this.sweepSign = 1; // +1 / -1 for increase / decrease freq
        
        // Envelope parameters
        this.envelopeStep = 0;
        this.envelopeStepLength = 0x10000;// 1 / 64 seconds of instructions
        this.envelopeCheck = false;
        this.envelopeSign = 1;
        this.envelopeVolume = 0;
        
        // Timing variables
        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;
        this.phase = 0; // Phase for sample generation

        // Audio setup (if context available)
        if (audioContext) {
            this.audioContext = audioContext;
        }
    }

    // Generate a single sample based on current state
    getSample() {
        if (!this.playing || this.volume === 0) return 0;
        
        // Update phase based on frequency
        this.phase += this.frequency / (2048 * 44100);
        this.phase %= 1.0;
        
        // Generate square wave with duty cycle
        return this.phase < this.dutyCycle ? this.volume/15 : -this.volume/15;
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;
        this.phase = 0;
        if (this.sweepShifts > 0) this.checkFreqSweep();
    }

    stop() {
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
        this.volume = volume;
    }

    enable() {
        // No need to reconnect audio nodes
        // We'll use the sample-based approach instead
    }

    disable() {
        this.playing = false;
    }
}

// Channel 3 implementation (wave form)
export class Channel3 {
    constructor(apu, channelNumber, audioContext) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;

        // Channel state
        this.soundLength = 0;
        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.lengthCheck = false;

        this.clockLength = 0;

        this.buffer = new Float32Array(32);

        // Audio setup (if context available)
        if (audioContext) {
            this.audioContext = audioContext;
        }
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        this.clockLength = 0;
    }

    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
    }

    update(clockElapsed) {
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
    }

    getFrequency() {
        var freq = 2048 - 65536 / (this.audioContext.sampleRate);
        return freq | 1;
    }

    setLength(value) {
        this.soundLength = 256 - value;
    }

    setWaveBufferByte(index, value) {
        var bufferIndex = index * 2;

        this.buffer[bufferIndex]   = (value >> 4) / 8 - 1; // value in buffer is in -1 -> 1
        this.buffer[bufferIndex+1] = (value & 0x0F) / 8 - 1;
    }

    getSample() {
        // Add implementation for generating a sample based on current state
        // For example, using the wave buffer
        return 0; // Replace with actual sample generation
    }

    enable() {
        // No need to reconnect audio nodes
        // We'll use the sample-based approach instead
    }

    disable() {
        this.playing = false;
    }
}

// Channel 4 implementation (noise)
export class Channel4 {
    constructor(apu, channelNumber, audioContext) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;

        // Channel state
        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.soundLength = 64; // defaults to 64 periods
        this.lengthCheck = false;

        this.clockLength = 0;

        // Audio setup (if context available)
        if (audioContext) {
            this.audioContext = audioContext;
        }
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        this.clockLength = 0;
    }

    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
    }

    update(clockElapsed) {
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

    getSample() {
        // Add implementation for generating a sample based on current state
        // For example, using a noise generator
        return 0; // Replace with actual sample generation
    }

    enable() {
        // No need to reconnect audio nodes
        // We'll use the sample-based approach instead
    }

    disable() {
        this.playing = false;
    }
}