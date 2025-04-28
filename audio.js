// audio.js - Audio Processing Unit and sound channels implementation
// Now interfaces with Web Worker for audio processing

import { Util } from './utils.js';

// Audio Processing Unit
// Listens the write accesses to the audio-reserved memory addresses
// and dispatches the data to the sound channels via Web Worker
export class APU {
    constructor(memory) {
        this.memory = memory;
        this.enabled = false;
        this.audioContext = null;
        this.worker = null;
        this.audioBuffer = [];
        this.audioBufferSize = 4096;
        this.scriptNode = null;
        this.gainNode = null;
        
        // Create channels with empty objects that will forward to worker
        this.channel1 = new WorkerChannel(1, this);
        this.channel2 = new WorkerChannel(2, this);
        this.channel3 = new WorkerChannel(3, this);
        this.channel4 = new WorkerChannel(4, this);
        
        this.initAudioSystem();
    }
    
    initAudioSystem() {
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            // Initialize worker
            this.initWorker();
            
            // Set up audio nodes
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 0.5;
            
            // Set up script processor node for custom audio processing
            this.scriptNode = this.audioContext.createScriptProcessor(2048, 0, 1);
            this.scriptNode.onaudioprocess = this.handleAudioProcess.bind(this);
            
            // Connect audio graph
            this.scriptNode.connect(this.gainNode);
            this.gainNode.connect(this.audioContext.destination);
        } catch (e) {
            console.error("Web Audio API is not supported in this browser", e);
        }
    }
    
    initWorker() {
        // Create worker and set up message handling
        this.worker = new Worker('audio-worker.js');
        
        this.worker.onmessage = (e) => {
            const data = e.data;
            
            switch (data.type) {
                case 'ready':
                    console.log('Audio worker ready');
                    // Initialize worker with current state
                    this.worker.postMessage({
                        type: 'init',
                        enabled: this.enabled
                    });
                    break;
                    
                case 'audioData':
                    // Add audio data to buffer
                    this.audioBuffer.push(data.output);
                    if (this.audioBuffer.length > this.audioBufferSize) {
                        this.audioBuffer.shift();
                    }
                    break;
                    
                case 'channelStatusUpdate':
                    // Update channel status flags in memory
                    this.setSoundFlag(data.channel, data.playing ? 1 : 0);
                    break;
                    
                case 'channelFrequencyUpdate':
                    // Update frequency in memory registers
                    this.updateChannelFrequency(data.channel, data.frequency);
                    break;
            }
        };
    }
    
    handleAudioProcess(e) {
        // Fill output buffer with data from our audio buffer
        const outputBuffer = e.outputBuffer.getChannelData(0);
        
        for (let i = 0; i < outputBuffer.length; i++) {
            if (this.audioBuffer.length > 0) {
                outputBuffer[i] = this.audioBuffer.shift();
            } else {
                outputBuffer[i] = 0;
            }
        }
        
        // Request more audio data from worker
        if (this.enabled) {
            this.worker.postMessage({
                type: 'process',
                clockElapsed: outputBuffer.length / this.audioContext.sampleRate * 4194304 // Convert to GB cycles
            });
        }
    }
    
    updateChannelFrequency(channelNum, frequency) {
        // Update memory registers based on channel number
        switch (channelNum) {
            case 1:
                this.memory[APU.registers.NR13] = frequency & 0xFF;
                this.memory[APU.registers.NR14] = (this.memory[APU.registers.NR14] & 0xF8) | ((frequency >> 8) & 0x7);
                break;
            case 2: 
                this.memory[APU.registers.NR23] = frequency & 0xFF;
                this.memory[APU.registers.NR24] = (this.memory[APU.registers.NR24] & 0xF8) | ((frequency >> 8) & 0x7);
                break;
            case 3:
                this.memory[APU.registers.NR33] = frequency & 0xFF;
                this.memory[APU.registers.NR34] = (this.memory[APU.registers.NR34] & 0xF8) | ((frequency >> 8) & 0x7);
                break;
        }
    }

    connect() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        this.enabled = true;
        this.worker?.postMessage({ type: 'enable', enabled: true });
    }

    disconnect() {
        this.enabled = false;
        this.worker?.postMessage({ type: 'enable', enabled: false });
    }

    // Updates the states of each channel given the elapsed time
    // (in instructions) since last update
    update(clockElapsed) {
        if (!this.enabled || !this.worker) return;
        
        // Process audio data in worker
        this.worker.postMessage({
            type: 'process',
            clockElapsed: clockElapsed
        });
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
                this.channel1.updateSweep({
                    sweepTime: ((value & 0x70) >> 4),
                    sweepSign: (value & 0x08) ? -1 : 1,
                    sweepShifts: (value & 0x07)
                });
                break;
            case 0xFF11:
                // todo : bits 6-7
                this.channel1.setLength(value & 0x3F);
                break;
            case 0xFF12:
                this.channel1.updateEnvelope({
                    envelopeSign: (value & 0x08) ? 1 : -1,
                    envelopeVolume: (value & 0xF0) >> 4,
                    envelopeStep: (value & 0x07)
                });
                break;
            case 0xFF13:
                this.channel1.updateFrequency((this.channel1.getFrequency() & 0xF00) | value);
                break;
            case 0xFF14:
                const freq1 = (this.channel1.getFrequency() & 0xFF) | ((value & 7) << 8);
                this.channel1.updateFrequency(freq1);
                this.channel1.setLengthCheck((value & 0x40) ? true : false);
                if (value & 0x80) this.channel1.play();
                break;

            // Channel 2 addresses
            case 0xFF16:
                // todo : bits 6-7
                this.channel2.setLength(value & 0x3F);
                break;
            case 0xFF17:
                this.channel2.updateEnvelope({
                    envelopeSign: (value & 0x08) ? 1 : -1,
                    envelopeVolume: (value & 0xF0) >> 4,
                    envelopeStep: (value & 0x07)
                });
                break;
            case 0xFF18:
                this.channel2.updateFrequency((this.channel2.getFrequency() & 0xF00) | value);
                break;
            case 0xFF19:
                const freq2 = (this.channel2.getFrequency() & 0xFF) | ((value & 7) << 8);
                this.channel2.updateFrequency(freq2);
                this.channel2.setLengthCheck((value & 0x40) ? true : false);
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
                this.channel3.updateFrequency((this.channel3.getFrequency() & 0xF00) | value);
                break;
            case 0xFF1E:
                const freq3 = (this.channel3.getFrequency() & 0xFF) | ((value & 7) << 8);
                this.channel3.updateFrequency(freq3);
                this.channel3.setLengthCheck((value & 0x40) ? true : false);
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
                this.channel4.setLengthCheck((value & 0x40) ? true : false);
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
                this.enabled = (value & 0x80) == 0 ? false : false;
                if (!this.enabled) {
                    for (var i = 0xFF10; i < 0xFF27; i++)
                        this.memory[i] = 0;
                    this.disconnect();
                } else {
                    this.connect();
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

// Worker Channel - proxies to the Web Worker
export class WorkerChannel {
    constructor(channelNumber, apu) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.frequency = 0;
        this.playing = false;
        this.lengthCheck = false;
        this.soundLength = 64;
        
        // Create initial parameters
        const initialParams = {
            frequency: 0,
            envelopeVolume: 0,
            playing: false,
            lengthCheck: false,
            soundLength: 64
        };
        
        // Initialize channel in worker
        this.apu.worker?.postMessage({
            type: 'createChannel',
            channel: channelNumber,
            params: initialParams
        });
    }

    play() {
        this.playing = true;
        this.apu.worker?.postMessage({
            type: 'playChannel',
            channel: this.channelNumber
        });
    }

    stop() {
        this.playing = false;
        this.apu.worker?.postMessage({
            type: 'stopChannel',
            channel: this.channelNumber
        });
    }

    updateFrequency(value) {
        this.frequency = value;
        this.apu.worker?.postMessage({
            type: 'updateChannel',
            channel: this.channelNumber,
            params: { frequency: value }
        });
    }

    getFrequency() {
        return this.frequency;
    }

    setLength(value) {
        this.soundLength = this.channelNumber === 3 ? (256 - value) : (64 - (value & 0x3F));
        this.apu.worker?.postMessage({
            type: 'updateChannel',
            channel: this.channelNumber,
            params: { soundLength: this.soundLength }
        });
    }

    setLengthCheck(value) {
        this.lengthCheck = value;
        this.apu.worker?.postMessage({
            type: 'updateChannel',
            channel: this.channelNumber,
            params: { lengthCheck: value }
        });
    }

    updateSweep(params) {
        this.apu.worker?.postMessage({
            type: 'updateChannel',
            channel: this.channelNumber,
            params: params
        });
    }

    updateEnvelope(params) {
        this.apu.worker?.postMessage({
            type: 'updateChannel',
            channel: this.channelNumber,
            params: params
        });
    }

    setWaveBufferByte(index, value) {
        // For Channel 3, we need to update the wave buffer
        if (this.channelNumber === 3) {
            // Convert byte to two float samples
            const sample1 = (value >> 4) / 8 - 1;
            const sample2 = (value & 0x0F) / 8 - 1;
            
            this.apu.worker?.postMessage({
                type: 'updateChannel',
                channel: 3,
                params: {
                    waveBufferUpdate: {
                        index: index * 2,
                        samples: [sample1, sample2]
                    }
                }
            });
        }
    }
}