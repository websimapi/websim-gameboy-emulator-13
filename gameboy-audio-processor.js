// gameboy-audio-processor.js - AudioWorklet processor for GameBoy audio

class GameboyAudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        
        // Buffer to store audio samples from main thread
        this.sampleBuffer = new Float32Array(4096);
        this.bufferSize = 0;
        this.readIndex = 0;
        
        // Track silence to avoid audio noise
        this.isActive = false;
        this.silenceCounter = 0;
        
        // Get processor options
        const processorOptions = options.processorOptions || {};
        this.isEnabled = processorOptions.initiallyEnabled || false;
        
        // Set up message port communication
        this.port.onmessage = (event) => {
            if (event.data.type === 'init') {
                // Store sample rate and prepare for processing
                this.sampleRate = event.data.sampleRate;
                this.isEnabled = !!event.data.enabled;
            } else if (event.data.type === 'audioData') {
                // Receive audio samples from main thread
                this.addSamples(event.data.samples);
            }
        };
        
        // Request initial samples
        this.requestSamples();
    }
    
    addSamples(samples) {
        // Add samples to the buffer
        if (!samples || samples.length === 0) return;
        
        // Check if we're receiving actual audio signal
        let hasSignal = false;
        for (let i = 0; i < samples.length; i++) {
            if (Math.abs(samples[i]) > 0.01) {
                hasSignal = true;
                break;
            }
        }
        
        if (hasSignal) {
            this.isActive = true;
            this.silenceCounter = 0;
        }
        
        // Copy samples to the buffer, with wrap-around if needed
        for (let i = 0; i < samples.length; i++) {
            this.sampleBuffer[this.bufferSize % this.sampleBuffer.length] = samples[i];
            this.bufferSize++;
        }
    }
    
    requestSamples() {
        // Tell the main thread we need more samples
        this.port.postMessage({
            type: 'needSamples'
        });
    }
    
    process(inputs, outputs, parameters) {
        // Get the output channel data
        const output = outputs[0];
        const channel = output[0];
        
        // Request more samples if buffer is getting low
        if (this.bufferSize - this.readIndex < 128) {
            this.requestSamples();
        }
        
        // Fill the output with available samples
        for (let i = 0; i < channel.length; i++) {
            if (this.readIndex < this.bufferSize) {
                channel[i] = this.sampleBuffer[this.readIndex % this.sampleBuffer.length];
                
                // Count silent samples
                if (Math.abs(channel[i]) < 0.01) {
                    this.silenceCounter++;
                    if (this.silenceCounter > 4410) { // ~100ms of silence
                        this.isActive = false;
                    }
                } else {
                    this.silenceCounter = 0;
                }
                
                this.readIndex++;
            } else {
                // Buffer underrun - output silence
                channel[i] = 0;
                this.requestSamples();
            }
            
            // If we're supposed to be silent, force silence
            if (!this.isEnabled || !this.isActive) {
                channel[i] = 0;
            }
        }
        
        // Keep the processor running
        return true;
    }
}

registerProcessor('gameboy-audio-processor', GameboyAudioProcessor);