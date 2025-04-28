// audio-worker.js - Web Worker for audio processing

// Audio state and processing logic
let audioState = {
  channels: {
    1: { playing: false, frequency: 0, volume: 0, sweepTime: 0, sweepShifts: 0, sweepSign: 1, envelopeStep: 0, envelopeSign: 1, clockLength: 0, clockEnvelop: 0, clockSweep: 0, soundLength: 64, lengthCheck: false },
    2: { playing: false, frequency: 0, volume: 0, envelopeStep: 0, envelopeSign: 1, clockLength: 0, clockEnvelop: 0, soundLength: 64, lengthCheck: false },
    3: { playing: false, frequency: 0, waveBuffer: new Float32Array(32), soundLength: 256, clockLength: 0, lengthCheck: false },
    4: { playing: false, soundLength: 64, clockLength: 0, lengthCheck: false }
  },
  enabled: false,
  registers: {},
  envelopeStepLength: 0x10000, // 1 / 64 seconds of instructions
  soundLengthUnit: 0x4000, // 1 / 256 second of instructions
  sweepStepLength: 0x8000 // 1 / 128 seconds of instructions
};

// Process audio updates based on elapsed clock cycles
function processAudio(elapsedCycles) {
  if (!audioState.enabled) return;
  
  // Process each channel
  for (let channelNum = 1; channelNum <= 4; channelNum++) {
    const channel = audioState.channels[channelNum];
    if (!channel.playing) continue;
    
    // Update channel parameters based on elapsed cycles
    updateChannel(channel, channelNum, elapsedCycles);
  }
  
  // Return current state to main thread
  return {
    channels: {
      1: getChannelState(1),
      2: getChannelState(2),
      3: getChannelState(3),
      4: getChannelState(4)
    }
  };
}

// Update a single channel's state
function updateChannel(channel, channelNum, elapsedCycles) {
  // Update clocks
  channel.clockEnvelop += elapsedCycles;
  
  if (channelNum === 1) {
    channel.clockSweep += elapsedCycles;
    
    // Process sweep for channel 1
    if ((channel.sweepCount || channel.sweepTime) && 
        channel.clockSweep > (audioState.sweepStepLength * channel.sweepTime)) {
      channel.clockSweep -= (audioState.sweepStepLength * channel.sweepTime);
      channel.sweepCount--;
      
      // Calculate new frequency with sweep
      const oldFreq = channel.frequency;
      const newFreq = oldFreq + channel.sweepSign * (oldFreq >> channel.sweepShifts);
      
      if (newFreq > 0x7FF) {
        channel.frequency = 0;
        channel.playing = false;
        return;
      }
      
      channel.frequency = newFreq;
    }
  }
  
  // Process envelope for channels 1, 2, 4
  if (channelNum <= 2 && channel.envelopeStep > 0 && 
      channel.clockEnvelop > audioState.envelopeStepLength) {
    channel.clockEnvelop -= audioState.envelopeStepLength;
    channel.envelopeStep--;
    
    channel.volume += channel.envelopeSign;
    
    // Clamp volume between 0-15
    if (channel.volume < 0) channel.volume = 0;
    if (channel.volume > 15) channel.volume = 15;
  }
  
  // Process length counter for all channels
  if (channel.lengthCheck) {
    channel.clockLength += elapsedCycles;
    if (channel.clockLength > audioState.soundLengthUnit) {
      channel.soundLength--;
      channel.clockLength -= audioState.soundLengthUnit;
      if (channel.soundLength === 0) {
        channel.playing = false;
      }
    }
  }
}

// Get the current state for a channel to send back to main thread
function getChannelState(channelNum) {
  const channel = audioState.channels[channelNum];
  return {
    playing: channel.playing,
    frequency: channel.frequency,
    volume: channel.volume,
    waveBuffer: channelNum === 3 ? Array.from(channel.waveBuffer) : undefined
  };
}

// Process register writes
function writeRegister(address, value) {
  audioState.registers[address] = value;
  
  // Channel 1 registers
  if (address >= 0xFF10 && address <= 0xFF14) {
    handleChannel1Register(address, value);
  } 
  // Channel 2 registers
  else if (address >= 0xFF16 && address <= 0xFF19) {
    handleChannel2Register(address, value);
  }
  // Channel 3 registers
  else if (address >= 0xFF1A && address <= 0xFF1E) {
    handleChannel3Register(address, value);
  }
  // Channel 4 registers
  else if (address >= 0xFF20 && address <= 0xFF23) {
    handleChannel4Register(address, value);
  }
  // Wave pattern data
  else if (address >= 0xFF30 && address <= 0xFF3F) {
    handleWaveData(address, value);
  }
  // Global audio control
  else if (address === 0xFF26) {
    audioState.enabled = (value & 0x80) !== 0;
  }
}

// Handle channel 1 register writes
function handleChannel1Register(address, value) {
  const channel = audioState.channels[1];
  
  switch (address) {
    case 0xFF10: // NR10: Sweep
      channel.clockSweep = 0;
      channel.sweepTime = ((value & 0x70) >> 4);
      channel.sweepSign = (value & 0x08) ? -1 : 1;
      channel.sweepShifts = (value & 0x07);
      channel.sweepCount = channel.sweepShifts;
      break;
    case 0xFF11: // NR11: Length and duty
      channel.soundLength = 64 - (value & 0x3F);
      break;
    case 0xFF12: // NR12: Envelope
      channel.envelopeSign = (value & 0x08) ? 1 : -1;
      channel.volume = (value & 0xF0) >> 4;
      channel.envelopeStep = (value & 0x07);
      break;
    case 0xFF13: // NR13: Frequency low
      channel.frequency = (channel.frequency & 0x700) | value;
      break;
    case 0xFF14: // NR14: Frequency high and control
      channel.frequency = (channel.frequency & 0xFF) | ((value & 0x07) << 8);
      channel.lengthCheck = (value & 0x40) !== 0;
      if (value & 0x80) {
        channel.playing = true;
        channel.clockLength = 0;
        channel.clockEnvelop = 0;
        channel.clockSweep = 0;
      }
      break;
  }
}

// Handle channel 2 register writes
function handleChannel2Register(address, value) {
  const channel = audioState.channels[2];
  
  switch (address) {
    case 0xFF16: // NR21: Length and duty
      channel.soundLength = 64 - (value & 0x3F);
      break;
    case 0xFF17: // NR22: Envelope
      channel.envelopeSign = (value & 0x08) ? 1 : -1;
      channel.volume = (value & 0xF0) >> 4;
      channel.envelopeStep = (value & 0x07);
      break;
    case 0xFF18: // NR23: Frequency low
      channel.frequency = (channel.frequency & 0x700) | value;
      break;
    case 0xFF19: // NR24: Frequency high and control
      channel.frequency = (channel.frequency & 0xFF) | ((value & 0x07) << 8);
      channel.lengthCheck = (value & 0x40) !== 0;
      if (value & 0x80) {
        channel.playing = true;
        channel.clockLength = 0;
        channel.clockEnvelop = 0;
      }
      break;
  }
}

// Handle channel 3 register writes
function handleChannel3Register(address, value) {
  const channel = audioState.channels[3];
  
  switch (address) {
    case 0xFF1A: // NR30: DAC power
      // Channel on/off
      break;
    case 0xFF1B: // NR31: Length
      channel.soundLength = 256 - value;
      break;
    case 0xFF1C: // NR32: Output level
      // Volume control
      break;
    case 0xFF1D: // NR33: Frequency low
      channel.frequency = (channel.frequency & 0x700) | value;
      break;
    case 0xFF1E: // NR34: Frequency high and control
      channel.frequency = (channel.frequency & 0xFF) | ((value & 0x07) << 8);
      channel.lengthCheck = (value & 0x40) !== 0;
      if (value & 0x80) {
        channel.playing = true;
        channel.clockLength = 0;
      }
      break;
  }
}

// Handle channel 4 register writes
function handleChannel4Register(address, value) {
  const channel = audioState.channels[4];
  
  switch (address) {
    case 0xFF20: // NR41: Length
      channel.soundLength = 64 - (value & 0x3F);
      break;
    case 0xFF21: // NR42: Envelope
      // Envelope parameters
      break;
    case 0xFF22: // NR43: Polynomial counter
      // Noise parameters
      break;
    case 0xFF23: // NR44: Counter/consecutive and initial
      channel.lengthCheck = (value & 0x40) !== 0;
      if (value & 0x80) {
        channel.playing = true;
        channel.clockLength = 0;
      }
      break;
  }
}

// Handle wave pattern data
function handleWaveData(address, value) {
  const index = address - 0xFF30;
  const channel = audioState.channels[3];
  
  // Each byte contains two samples
  channel.waveBuffer[index * 2] = (value >> 4) / 8 - 1;
  channel.waveBuffer[index * 2 + 1] = (value & 0x0F) / 8 - 1;
}

// Message handler for worker
self.onmessage = function(e) {
  const message = e.data;
  
  switch (message.type) {
    case 'update':
      // Process audio with elapsed cycles
      const result = processAudio(message.elapsedCycles);
      self.postMessage({ type: 'state', data: result });
      break;
      
    case 'write':
      // Handle register write
      writeRegister(message.address, message.value);
      break;
      
    case 'play':
      // Start channel playback
      audioState.channels[message.channel].playing = true;
      audioState.channels[message.channel].clockLength = 0;
      audioState.channels[message.channel].clockEnvelop = 0;
      if (message.channel === 1) {
        audioState.channels[message.channel].clockSweep = 0;
      }
      break;
      
    case 'stop':
      // Stop channel playback
      audioState.channels[message.channel].playing = false;
      break;
      
    case 'enable':
      // Enable/disable audio processing
      audioState.enabled = message.value;
      break;
  }
};