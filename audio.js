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
        this.audioContext = new AudioContext();

        // Initialize audio channels
        this.channel1 = new Channel1(this, 1, this.audioContext);
        this.channel2 = new Channel1(this, 2, this.audioContext);
        this.channel3 = new Channel3(this, 3, this.audioContext);
        this.channel4 = new Channel4(this, 4, this.audioContext);
        
        // Create worker for audio processing
        this.initializeWorker();
    }

    initializeWorker() {
        // Create Web Worker for audio processing
        this.worker = new Worker('./audio-worker.js');
        
        // Set up message handler for worker communication
        this.worker.onmessage = (e) => {
            if (e.data.type === 'state') {
                this.updateFromWorker(e.data.data);
            }
        };
    }

    // Update audio state from worker data
    updateFromWorker(data) {
        // Update each channel from worker data
        for (let channelNum = 1; channelNum <= 4; channelNum++) {
            const channelData = data.channels[channelNum];
            const channel = this.getChannel(channelNum);
            
            if (channel && channelData) {
                // Update audio node parameters based on worker data
                if (channelData.playing !== channel.playing) {
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
        this.channel1.enable();
        this.channel2.enable();
        this.channel3.enable();
        this.worker.postMessage({ type: 'enable', value: true });
    }

    disconnect() {
        this.channel1.disable();
        this.channel2.disable();
        this.channel3.disable();
        this.worker.postMessage({ type: 'enable', value: false });
    }

    // Updates the states of each channel given the elapsed time
    // (in instructions) since last update
    update(clockElapsed) {
        if (this.enabled === false) return;
        
        // Send update request to worker
        this.worker.postMessage({ 
            type: 'update', 
            elapsedCycles: clockElapsed 
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

        // Send register write to worker
        this.worker.postMessage({
            type: 'write',
            address: addr,
            value: value
        });

        // Handle special cases for direct Web Audio API interaction
        switch (addr) {
            case 0xFF14: // Channel 1 control
                if (value & 0x80) this.channel1.play();
                break;
            case 0xFF19: // Channel 2 control
                if (value & 0x80) this.channel2.play();
                break;
            case 0xFF1E: // Channel 3 control
                if (value & 0x80) this.channel3.play();
                break;
            case 0xFF23: // Channel 4 control
                if (value & 0x80) this.channel4.play();
                break;
            case 0xFF26: // Global audio control
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
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        this.gainNode.connect(this.audioContext.destination);
        
        // Notify worker to start playback
        this.apu.worker.postMessage({
            type: 'play',
            channel: this.channelNumber
        });
    }

    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        this.gainNode.disconnect();
        
        // Notify worker to stop playback
        this.apu.worker.postMessage({
            type: 'stop',
            channel: this.channelNumber
        });
    }

    setFrequency(value) {
        this.frequency = value;
        // Convert GB frequency to Hz
        this.oscillator.frequency.value = 131072 / (2048 - this.frequency);
    }

    setEnvelopeVolume(volume) {
        this.envelopeVolume = volume;
        // Scale volume to gain (0-15 to 0-0.15)
        this.gainNode.gain.value = this.envelopeVolume * 1/100;
    }

    disable() {
        this.oscillator.disconnect();
    }

    enable() {
        this.oscillator.connect(this.gainNode);
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
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Copy wave buffer data to audio buffer
        this.waveBuffer.copyToChannel(this.buffer, 0, 0);
        this.gainNode.connect(this.audioContext.destination);
        
        // Notify worker to start playback
        this.apu.worker.postMessage({
            type: 'play',
            channel: this.channelNumber
        });
    }

    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        this.gainNode.disconnect();
        
        // Notify worker to stop playback
        this.apu.worker.postMessage({
            type: 'stop',
            channel: this.channelNumber
        });
    }

    setFrequency(value) {
        this.frequency = value;
        // Convert GB frequency to playback rate
        const rate = 65536 / (2048 - value);
        this.bufferSource.playbackRate.value = rate / this.baseSpeed;
    }

    updateWaveBuffer(bufferData) {
        // Update local buffer from worker data
        for (let i = 0; i < 32; i++) {
            this.buffer[i] = bufferData[i];
        }
        
        // Apply to audio buffer if playing
        if (this.playing) {
            this.waveBuffer.copyToChannel(this.buffer, 0, 0);
        }
    }

    setWaveBufferByte(index, value) {
        var bufferIndex = index * 2;
        // Convert wave data from byte to -1.0 to 1.0 float samples
        this.buffer[bufferIndex] = (value >> 4) / 8 - 1; 
        this.buffer[bufferIndex+1] = (value & 0x0F) / 8 - 1;
        
        // Send wave data to worker
        this.apu.worker.postMessage({
            type: 'write',
            address: 0xFF30 + index,
            value: value
        });
    }

    disable() {
        this.bufferSource.disconnect();
    }

    enable() {
        this.bufferSource.connect(this.gainNode);
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
        this.apu.worker.postMessage({
            type: 'play',
            channel: this.channelNumber
        });
    }

    stop() {
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        // Notify worker to stop playback
        this.apu.worker.postMessage({
            type: 'stop',
            channel: this.channelNumber
        });
    }
}