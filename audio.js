// audio.js - Audio Processing Unit with Web Worker support

// Audio Processing unit
// Listens the write accesses to the audio-reserved memory addresses
// and dispatches the data to the sound channels
export class APU {
    constructor(memory) {
        this.memory = memory;
        this.enabled = false;

        // Set up Web Audio context
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        try {
            this.audioContext = new AudioContext();
        } catch (e) {
            console.warn('Web Audio API not supported in this browser.');
            this.audioContext = null;
        }

        // Initialize audio channels
        this.channel1 = new Channel1(this, 1, this.audioContext);
        this.channel2 = new Channel1(this, 2, this.audioContext);
        this.channel3 = new Channel3(this, 3, this.audioContext);
        this.channel4 = new Channel4(this, 4, this.audioContext);
        
        // Track state and registers for fallback when worker fails
        this.registers = {};
        this.useWorker = typeof Worker !== 'undefined';
        
        // Initialize worker with error handling
        if (this.useWorker) {
            this.initializeWorker();
        } else {
            console.warn('Web Workers not supported in this browser. Audio processing will run on the main thread.');
        }
    }

    initializeWorker() {
        try {
            // Create Web Worker for audio processing
            this.worker = new Worker('./audio-worker.js');
            
            // Set up message handler for worker communication
            this.worker.onmessage = (e) => {
                if (e.data.type === 'state') {
                    this.updateFromWorker(e.data.data);
                } else if (e.data.type === 'error') {
                    console.error('Audio worker error:', e.data.message);
                    this.useWorker = false;
                }
            };
            
            // Handle worker errors
            this.worker.onerror = (e) => {
                console.error('Audio worker failed to initialize:', e.message);
                this.useWorker = false;
            };
        } catch (e) {
            console.error('Failed to create audio worker:', e);
            this.useWorker = false;
        }
    }

    // Update audio state from worker data
    updateFromWorker(data) {
        if (!data || !data.channels) return;
        
        // Update each channel from worker data
        for (let channelNum = 1; channelNum <= 4; channelNum++) {
            const channelData = data.channels[channelNum];
            const channel = this.getChannel(channelNum);
            
            if (channel && channelData) {
                // Update audio node parameters based on worker data
                if (channelData.playing !== undefined && 
                    channelData.playing !== channel.playing) {
                    if (channelData.playing) {
                        channel.connect();
                    } else {
                        channel.disconnect();
                    }
                    channel.playing = channelData.playing;
                }
                
                if (channelData.frequency !== undefined && 
                    channelData.frequency !== channel.frequency) {
                    channel.setFrequency(channelData.frequency);
                }
                
                if (channelData.volume !== undefined && 
                    channelData.volume !== channel.envelopeVolume) {
                    channel.setEnvelopeVolume(channelData.volume);
                }
                
                // For channel 3, update wave buffer if needed
                if (channelNum === 3 && channelData.waveBuffer) {
                    channel.updateWaveBuffer(channelData.waveBuffer);
                }
            }
        }
    }

    // Get channel by number
    getChannel(channelNum) {
        switch (channelNum) {
            case 1: return this.channel1;
            case 2: return this.channel2;
            case 3: return this.channel3;
            case 4: return this.channel4;
            default: return null;
        }
    }

    connect() {
        this.enabled = true;
        this.channel1.enable();
        this.channel2.enable();
        this.channel3.enable();
        if (this.useWorker && this.worker) {
            this.worker.postMessage({ type: 'enable', value: true });
        }
    }

    disconnect() {
        this.enabled = false;
        this.channel1.disable();
        this.channel2.disable();
        this.channel3.disable();
        if (this.useWorker && this.worker) {
            this.worker.postMessage({ type: 'enable', value: false });
        }
    }

    // Updates the states of each channel given the elapsed time
    // (in instructions) since last update
    update(clockElapsed) {
        if (!this.enabled) return;
        
        // If using worker, send update request to worker
        if (this.useWorker && this.worker) {
            try {
                this.worker.postMessage({ 
                    type: 'update', 
                    elapsedCycles: clockElapsed 
                });
            } catch (e) {
                console.error('Error sending message to audio worker:', e);
                this.useWorker = false;
            }
        } else {
            // Fallback: basic update on main thread
            // This is a simplified version that won't do full audio processing
            // but will at least keep the emulator running
            this.updateBasic(clockElapsed);
        }
    }

    // Basic update function for when worker is not available
    updateBasic(clockElapsed) {
        // Simple update that just keeps track of envelope timing
        // This is a minimal implementation to keep the emulator running
        // without full audio processing
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
        
        // Store register value locally
        this.registers[addr] = value;
        this.memory[addr] = value;

        // If using worker, send register write to worker
        if (this.useWorker && this.worker) {
            try {
                this.worker.postMessage({
                    type: 'write',
                    address: addr,
                    value: value
                });
            } catch (e) {
                console.error('Error sending write message to audio worker:', e);
                this.useWorker = false;
            }
        }

        // Handle special cases for direct Web Audio API interaction
        switch (addr) {
            case APU.registers.NR14: // Channel 1 control
                if (value & 0x80) this.channel1.play();
                break;
            case APU.registers.NR24: // Channel 2 control
                if (value & 0x80) this.channel2.play();
                break;
            case APU.registers.NR34: // Channel 3 control
                if (value & 0x80) this.channel3.play();
                break;
            case APU.registers.NR44: // Channel 4 control
                if (value & 0x80) this.channel4.play();
                break;
            case APU.registers.NR52: // Global audio control
                this.enabled = (value & 0x80) != 0;
                if (!this.enabled) {
                    this.channel1.stop();
                    this.channel2.stop();
                    this.channel3.stop();
                    this.channel4.stop();
                    // Clear registers
                    for (var i = 0xFF10; i < 0xFF27; i++)
                        this.memory[i] = 0;
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
        this.frequency = 0;
        this.envelopeVolume = 0;

        // Handle no audio context case
        if (!audioContext) {
            return;
        }

        try {
            // Create audio nodes
            var gainNode = audioContext.createGain();
            gainNode.gain.value = 0;
            
            var oscillator = audioContext.createOscillator();
            oscillator.type = 'square';
            oscillator.frequency.value = 1000;
            oscillator.connect(gainNode);
            oscillator.start(0);

            this.audioContext = audioContext;
            this.gainNode = gainNode;
            this.oscillator = oscillator;
        } catch (e) {
            console.error('Error creating audio nodes:', e);
        }
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        if (this.gainNode && this.audioContext) {
            try {
                this.gainNode.connect(this.audioContext.destination);
            } catch (e) {
                console.error('Error connecting audio node:', e);
            }
        }
        
        // Notify worker to start playback
        if (this.apu.useWorker && this.apu.worker) {
            try {
                this.apu.worker.postMessage({
                    type: 'play',
                    channel: this.channelNumber
                });
            } catch (e) {
                console.error('Error sending play message to worker:', e);
            }
        }
    }

    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        if (this.gainNode) {
            try {
                this.gainNode.disconnect();
            } catch (e) {
                console.error('Error disconnecting audio node:', e);
            }
        }
        
        // Notify worker to stop playback
        if (this.apu.useWorker && this.apu.worker) {
            try {
                this.apu.worker.postMessage({
                    type: 'stop',
                    channel: this.channelNumber
                });
            } catch (e) {
                console.error('Error sending stop message to worker:', e);
            }
        }
    }

    setFrequency(value) {
        this.frequency = value;
        // Convert GB frequency to Hz
        if (this.oscillator) {
            try {
                this.oscillator.frequency.value = 131072 / (2048 - this.frequency);
            } catch (e) {
                console.error('Error setting oscillator frequency:', e);
            }
        }
    }

    setEnvelopeVolume(volume) {
        this.envelopeVolume = volume;
        // Scale volume to gain (0-15 to 0-0.15)
        if (this.gainNode) {
            try {
                this.gainNode.gain.value = this.envelopeVolume * 1/100;
            } catch (e) {
                console.error('Error setting gain value:', e);
            }
        }
    }

    disconnect() {
        if (this.oscillator) {
            try {
                this.oscillator.disconnect();
            } catch (e) {
                console.error('Error disconnecting oscillator:', e);
            }
        }
    }

    connect() {
        if (this.oscillator && this.gainNode) {
            try {
                this.oscillator.connect(this.gainNode);
            } catch (e) {
                console.error('Error connecting oscillator to gain node:', e);
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
        this.frequency = 0;

        // Create buffer for wave data
        this.buffer = new Float32Array(32);

        // Handle no audio context case
        if (!audioContext) {
            return;
        }

        try {
            // Create audio nodes
            var gainNode = audioContext.createGain();
            gainNode.gain.value = 1;
            this.gainNode = gainNode;

            this.baseSpeed = 65536;
            var waveBuffer = audioContext.createBuffer(1, 32, this.baseSpeed);

            var bufferSource = audioContext.createBufferSource();
            bufferSource.buffer = waveBuffer;
            bufferSource.loop = true;
            bufferSource.connect(gainNode);
            bufferSource.start(0);

            this.audioContext = audioContext;
            this.waveBuffer = waveBuffer;
            this.bufferSource = bufferSource;
        } catch (e) {
            console.error('Error creating wave channel audio nodes:', e);
        }
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Copy wave buffer data to audio buffer
        if (this.waveBuffer && this.gainNode && this.audioContext) {
            try {
                this.waveBuffer.copyToChannel(this.buffer, 0, 0);
                this.gainNode.connect(this.audioContext.destination);
            } catch (e) {
                console.error('Error starting wave playback:', e);
            }
        }
        
        // Notify worker to start playback
        if (this.apu.useWorker && this.apu.worker) {
            try {
                this.apu.worker.postMessage({
                    type: 'play',
                    channel: this.channelNumber
                });
            } catch (e) {
                console.error('Error sending play message to worker:', e);
            }
        }
    }

    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        if (this.gainNode) {
            try {
                this.gainNode.disconnect();
            } catch (e) {
                console.error('Error disconnecting gain node:', e);
            }
        }
        
        // Notify worker to stop playback
        if (this.apu.useWorker && this.apu.worker) {
            try {
                this.apu.worker.postMessage({
                    type: 'stop',
                    channel: this.channelNumber
                });
            } catch (e) {
                console.error('Error sending stop message to worker:', e);
            }
        }
    }

    setFrequency(value) {
        this.frequency = value;
        // Convert GB frequency to playback rate
        if (this.bufferSource) {
            try {
                const rate = 65536 / (2048 - value);
                this.bufferSource.playbackRate.value = rate / this.baseSpeed;
            } catch (e) {
                console.error('Error setting buffer source playback rate:', e);
            }
        }
    }

    updateWaveBuffer(bufferData) {
        // Update local buffer from worker data
        for (let i = 0; i < 32 && i < bufferData.length; i++) {
            this.buffer[i] = bufferData[i];
        }
        
        // Apply to audio buffer if playing
        if (this.playing && this.waveBuffer) {
            try {
                this.waveBuffer.copyToChannel(this.buffer, 0, 0);
            } catch (e) {
                console.error('Error updating wave buffer:', e);
            }
        }
    }

    setWaveBufferByte(index, value) {
        var bufferIndex = index * 2;
        // Convert wave data from byte to -1.0 to 1.0 float samples
        this.buffer[bufferIndex] = (value >> 4) / 8 - 1; 
        this.buffer[bufferIndex+1] = (value & 0x0F) / 8 - 1;
        
        // Send wave data to worker
        if (this.apu.useWorker && this.apu.worker) {
            try {
                this.apu.worker.postMessage({
                    type: 'write',
                    address: 0xFF30 + index,
                    value: value
                });
            } catch (e) {
                console.error('Error sending wave buffer update to worker:', e);
            }
        }
    }

    disable() {
        if (this.bufferSource) {
            try {
                this.bufferSource.disconnect();
            } catch (e) {
                console.error('Error disabling buffer source:', e);
            }
        }
    }

    enable() {
        if (this.bufferSource && this.gainNode) {
            try {
                this.bufferSource.connect(this.gainNode);
            } catch (e) {
                console.error('Error enabling buffer source:', e);
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
        
        // In a real implementation, we would create a noise generator here
        // For this simplified version, we'll just track state
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Notify worker to start playback
        if (this.apu.useWorker && this.apu.worker) {
            try {
                this.apu.worker.postMessage({
                    type: 'play',
                    channel: this.channelNumber
                });
            } catch (e) {
                console.error('Error sending play message to worker:', e);
            }
        }
    }

    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        // Notify worker to stop playback
        if (this.apu.useWorker && this.apu.worker) {
            try {
                this.apu.worker.postMessage({
                    type: 'stop',
                    channel: this.channelNumber
                });
            } catch (e) {
                console.error('Error sending stop message to worker:', e);
            }
        }
    }
}