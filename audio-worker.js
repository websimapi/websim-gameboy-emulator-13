// audio-worker.js - Web Worker for audio processing
// Updated to work with AudioWorklet for better performance

// Sound state variables
let soundEnabled = false;
let channels = {
  1: null, // Channel 1 (Square wave with sweep)
  2: null, // Channel 2 (Square wave)
  3: null, // Channel 3 (Wave output)
  4: null  // Channel 4 (Noise)
};

// Sound channel classes definitions
class Channel1 {
  constructor(data) {
    this.frequency = data.frequency || 0;
    this.envelopeVolume = data.envelopeVolume || 0;
    this.playing = false;
    this.sweepTime = data.sweepTime || 0;
    this.sweepSign = data.sweepSign || 1;
    this.sweepShifts = data.sweepShifts || 0;
    this.clockLength = 0;
    this.clockEnvelop = 0;
    this.clockSweep = 0;
    this.soundLength = 64; // defaults to 64 periods
    this.sweepCounter = 0;
    this.output = 0;
    this.cyclePos = 0;
    
    // Constants for envelope timing
    this.sweepStepLength = 21845; // approx GB cycles (4194304/512)
  }

  update(clockElapsed) {
    if (!this.playing || !soundEnabled) return 0;
    
    this.clockEnvelop += clockElapsed;
    this.clockSweep += clockElapsed;
    
    // Process sweep
    if ((this.sweepShifts || this.sweepTime) && this.clockSweep > this.sweepStepLength * this.sweepTime) {
      this.clockSweep -= this.sweepStepLength * this.sweepTime;
      this.frequency = this.calculateSweepFrequency();
      
      // Post frequency update back to main thread
      postMessage({
        type: 'channelFrequencyUpdate',
        channel: 1,
        frequency: this.frequency
      });
    }
    
    // Generate actual sound sample
    this.updateWaveform(clockElapsed);
    
    return this.output;
  }
  
  calculateSweepFrequency() {
    if (this.sweepTime === 0 || this.sweepShifts === 0) return this.frequency;
    
    const oldFreq = this.frequency;
    const newFreq = oldFreq + this.sweepSign * (oldFreq >> this.sweepShifts);
    
    if (newFreq > 0x7FF || newFreq < 0) {
      this.stop();
      return 0;
    }
    
    return newFreq;
  }
  
  updateWaveform(clockElapsed) {
    // Square wave generation with duty cycle 50%
    // Avoid division by zero and overly high frequencies
    if (this.frequency === 0 || this.frequency >= 2048) {
      this.output = 0;
      return;
    }
    
    const period = 131072 / (2048 - this.frequency);
    this.cyclePos = (this.cyclePos + clockElapsed / period) % 1.0;
    
    // Scale output to avoid excessive volume
    const volume = this.envelopeVolume / 15 * 0.25;
    this.output = this.cyclePos < 0.5 ? volume : -volume;
  }
  
  play() {
    this.playing = true;
    this.cyclePos = 0;
    postMessage({ type: 'channelStatusUpdate', channel: 1, playing: true });
  }
  
  stop() {
    this.playing = false;
    this.output = 0;
    postMessage({ type: 'channelStatusUpdate', channel: 1, playing: false });
  }
  
  reset() {
    this.playing = false;
    this.output = 0;
    this.cyclePos = 0;
    this.clockLength = 0;
    this.clockEnvelop = 0;
    this.clockSweep = 0;
    this.sweepCounter = 0;
  }
}

class Channel2 extends Channel1 {
  constructor(data) {
    super(data);
  }
}

class Channel3 {
  constructor(data) {
    this.frequency = data.frequency || 0;
    this.playing = false;
    this.waveBuffer = new Float32Array(32).fill(0);
    this.wavePos = 0;
    this.output = 0;
  }
  
  update(clockElapsed) {
    if (!this.playing || !soundEnabled) return 0;

    // Wave playback logic
    // Avoid division by zero
    if (this.frequency === 0 || this.frequency >= 2048) {
      this.output = 0;
      return 0;
    }
    
    const period = 65536 / (2048 - this.frequency);
    this.wavePos = (this.wavePos + clockElapsed / period) % 32;
    
    // Use weighted interpolation between samples
    const pos = this.wavePos;
    const index = Math.floor(pos);
    const fraction = pos - index;
    const sample1 = this.waveBuffer[index];
    const sample2 = this.waveBuffer[(index + 1) % 32];
    
    // Linear interpolation with volume scaling
    this.output = (sample1 * (1 - fraction) + sample2 * fraction) * 0.15;
    
    return this.output;
  }
  
  play() {
    this.playing = true;
    this.wavePos = 0;
    postMessage({ type: 'channelStatusUpdate', channel: 3, playing: true });
  }
  
  stop() {
    this.playing = false;
    this.output = 0;
    postMessage({ type: 'channelStatusUpdate', channel: 3, playing: false });
  }
  
  updateWaveBuffer(index, samples) {
    if (Array.isArray(samples) && samples.length === 2) {
      this.waveBuffer[index] = samples[0];
      this.waveBuffer[index + 1] = samples[1];
    }
  }
  
  reset() {
    this.playing = false;
    this.output = 0;
    this.wavePos = 0;
    // Clear wave buffer to silence
    this.waveBuffer.fill(0);
  }
}

class Channel4 {
  constructor(data) {
    this.playing = false;
    this.lfsr = 0x7FFF; // Linear feedback shift register
    this.output = 0;
    this.clockRate = data.clockRate || 1;
    this.clockPos = 0;
    this.envelopeVolume = data.envelopeVolume || 8;
  }
  
  update(clockElapsed) {
    if (!this.playing || !soundEnabled) return 0;
    
    // Noise generation using LFSR
    this.clockPos += clockElapsed;
    if (this.clockPos > this.clockRate * 16) { // Scale for better audio rate
      this.clockPos -= this.clockRate * 16;
      
      // LFSR algorithm for GB noise channel
      const bit = ((this.lfsr & 0x1) ^ ((this.lfsr & 0x2) >> 1)) & 0x1;
      this.lfsr = (this.lfsr >> 1) | (bit << 14);
      
      // Generate output based on LFSR (0 or 1)
      // Scale down noise output to avoid excessive volume
      const outputLevel = (this.lfsr & 0x1) ? this.envelopeVolume/15 * 0.15 : -this.envelopeVolume/15 * 0.15;
      this.output = outputLevel;
    }
    
    return this.output;
  }
  
  play() {
    this.playing = true;
    this.lfsr = 0x7FFF;
    this.clockPos = 0;
    postMessage({ type: 'channelStatusUpdate', channel: 4, playing: true });
  }
  
  stop() {
    this.playing = false;
    this.output = 0;
    postMessage({ type: 'channelStatusUpdate', channel: 4, playing: false });
  }
  
  reset() {
    this.playing = false;
    this.output = 0;
    this.lfsr = 0x7FFF;
    this.clockPos = 0;
  }
}

// Buffer processing function - generates audio samples
function processAudio(clockElapsed) {
  if (!soundEnabled) return 0;
  
  // Process each channel and combine outputs
  let output = 0;
  
  if (channels[1]) output += channels[1].update(clockElapsed);
  if (channels[2]) output += channels[2].update(clockElapsed);
  if (channels[3]) output += channels[3].update(clockElapsed);
  if (channels[4]) output += channels[4].update(clockElapsed);
  
  // Normalize combined output (prevent clipping)
  // Apply soft clipping to avoid harsh audio distortion
  if (output > 1.0) output = Math.tanh(output);
  else if (output < -1.0) output = -Math.tanh(-output);
  
  return output;
}

// Reset all channels to silence
function resetAllChannels() {
  for (let i = 1; i <= 4; i++) {
    if (channels[i]) {
      channels[i].reset();
      channels[i].stop();
    }
  }
}

// Message handler for worker
self.onmessage = function(e) {
  const data = e.data;

  switch (data.type) {
    case 'init':
      soundEnabled = data.enabled;
      break;
      
    case 'enable':
      soundEnabled = data.enabled;
      if (!soundEnabled) {
        // Ensure all channels are silent when disabled
        resetAllChannels();
      }
      break;
    
    case 'resetChannels':
      resetAllChannels();
      break;
      
    case 'createChannel':
      switch (data.channel) {
        case 1:
          channels[1] = new Channel1(data.params);
          break;
        case 2:
          channels[2] = new Channel2(data.params);
          break;
        case 3:
          channels[3] = new Channel3(data.params);
          break;
        case 4:
          channels[4] = new Channel4(data.params);
          break;
      }
      break;
      
    case 'playChannel':
      if (channels[data.channel]) {
        channels[data.channel].play();
      }
      break;
      
    case 'stopChannel':
      if (channels[data.channel]) {
        channels[data.channel].stop();
      }
      break;
      
    case 'updateChannel':
      if (channels[data.channel]) {
        // Handle special cases for channel-specific updates
        if (data.params.waveBufferUpdate && data.channel === 3) {
          channels[3].updateWaveBuffer(data.params.waveBufferUpdate.index, data.params.waveBufferUpdate.samples);
        } else {
          // General parameter updates
          Object.assign(channels[data.channel], data.params);
        }
      }
      break;
      
    case 'process':
      // Only process when enabled
      if (!soundEnabled) {
        postMessage({
          type: 'audioData',
          output: new Array(128).fill(0)
        });
        return;
      }
      
      // Process audio for the given clock elapsed time
      // Generate a batch of samples
      const batchSize = 128; // Generate 128 samples per request
      const samplesPerCycle = data.clockElapsed / batchSize;
      
      const outputs = new Array(batchSize);
      for (let i = 0; i < batchSize; i++) {
        outputs[i] = processAudio(samplesPerCycle);
      }
      
      postMessage({
        type: 'audioData',
        output: outputs
      });
      break;
  }
};

// Inform main thread that worker is ready
postMessage({ type: 'ready' });