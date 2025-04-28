// audio-worker.js - Web Worker for audio processing
// Handles sound channel emulation in a separate thread

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
  }

  update(clockElapsed) {
    if (!this.playing) return 0;
    
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
    const oldFreq = this.frequency;
    const newFreq = oldFreq + this.sweepSign * (oldFreq >> this.sweepShifts);
    
    if (newFreq > 0x7FF) {
      this.stop();
      return 0;
    }
    
    return newFreq;
  }
  
  updateWaveform(clockElapsed) {
    // Simple square wave generation
    const period = 131072 / (2048 - this.frequency);
    this.cyclePos = (this.cyclePos + clockElapsed / period) % 1.0;
    this.output = this.cyclePos < 0.5 ? this.envelopeVolume * 1/100 : -this.envelopeVolume * 1/100;
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
  
  setFrequency(freq) {
    this.frequency = freq;
  }
  
  setEnvelopeVolume(volume) {
    this.envelopeVolume = volume;
  }
}

// Similar implementations for other channels...
class Channel2 extends Channel1 {
  constructor(data) {
    super(data);
  }
}

class Channel3 {
  constructor(data) {
    this.frequency = data.frequency || 0;
    this.playing = false;
    this.waveBuffer = new Float32Array(32);
    this.wavePos = 0;
    this.output = 0;
  }
  
  update(clockElapsed) {
    if (!this.playing) return 0;

    // Custom wave playback logic
    const period = 65536 / (2048 - this.frequency);
    this.wavePos = (this.wavePos + clockElapsed / period) % 32;
    this.output = this.waveBuffer[Math.floor(this.wavePos)];
    
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
  
  setWaveData(data) {
    this.waveBuffer = new Float32Array(data);
  }
  
  setFrequency(freq) {
    this.frequency = freq;
  }
}

class Channel4 {
  constructor(data) {
    this.playing = false;
    this.lfsr = 0x7FFF; // Linear feedback shift register
    this.output = 0;
    this.clockRate = data.clockRate || 1;
    this.clockPos = 0;
  }
  
  update(clockElapsed) {
    if (!this.playing) return 0;
    
    // Noise generation using LFSR
    this.clockPos += clockElapsed;
    if (this.clockPos > this.clockRate) {
      this.clockPos -= this.clockRate;
      // LFSR algorithm for GB noise channel
      const bit = ((this.lfsr & 0x1) ^ ((this.lfsr & 0x2) >> 1)) & 0x1;
      this.lfsr = (this.lfsr >> 1) | (bit << 14);
      this.output = (this.lfsr & 0x1) ? 0.1 : -0.1;
    }
    
    return this.output;
  }
  
  play() {
    this.playing = true;
    this.lfsr = 0x7FFF;
    postMessage({ type: 'channelStatusUpdate', channel: 4, playing: true });
  }
  
  stop() {
    this.playing = false;
    this.output = 0;
    postMessage({ type: 'channelStatusUpdate', channel: 4, playing: false });
  }
}

// Buffer processing function - generates audio samples
function processAudio(clockElapsed) {
  if (!soundEnabled) return;
  
  // Process each channel and combine outputs
  let output = 0;
  
  if (channels[1]) output += channels[1].update(clockElapsed);
  if (channels[2]) output += channels[2].update(clockElapsed);
  if (channels[3]) output += channels[3].update(clockElapsed);
  if (channels[4]) output += channels[4].update(clockElapsed);
  
  // Send audio output to main thread
  return output * 0.25; // Normalize combined output
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
        Object.assign(channels[data.channel], data.params);
      }
      break;
      
    case 'setWaveData':
      if (channels[3]) {
        channels[3].setWaveData(data.waveData);
      }
      break;
      
    case 'process':
      // Process audio for the given clock elapsed time
      const output = processAudio(data.clockElapsed);
      postMessage({
        type: 'audioData',
        output: output
      });
      break;
  }
};

// Inform main thread that worker is ready
postMessage({ type: 'ready' });