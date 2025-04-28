// debug.js - Optimized debugging system

export class DebugSystem {
  constructor(gameboy) {
    this.gameboy = gameboy;
    this.enabled = false;
    this.breakpoints = new Set();
    this.metrics = {
      frameTime: [],
      lastFrameTime: 0,
      avgFps: 0,
      instructionCount: 0
    };
    this.logHistory = [];
    this.maxLogHistory = 100;
    this.paused = false;
    this.stepMode = false;
    
    // Use a ring buffer for opcodes to avoid constant array shifts
    this.opcodeHistorySize = 10;
    this.opcodeHistory = new Array(this.opcodeHistorySize);
    this.opcodeHistoryIndex = 0;
    
    // Performance optimizations
    this.throttleInterval = 250; // Update UI every 250ms instead of every frame
    this.lastUIUpdate = 0;
    this.uiUpdateScheduled = false;
    this.performanceMode = true; // Default to performance-focused debugging
    
    // Use Map for breakpoints for faster lookup
    this.breakpointMap = new Map();
    
    // Cached DOM elements
    this.domElements = {};
    
    this.createDebugUI();
  }

  createDebugUI() {
    // Create debug panel if it doesn't exist
    if (!document.getElementById('debug-panel')) {
      const debugPanel = document.createElement('div');
      debugPanel.id = 'debug-panel';
      debugPanel.className = 'debug-panel';
      debugPanel.style.display = 'none'; // Start hidden
      
      // Add content to debug panel
      debugPanel.innerHTML = `
        <div class="debug-header">
          <h3>GameboyJS Debugger</h3>
          <div class="debug-controls">
            <button id="debug-pause">Pause</button>
            <button id="debug-step">Step</button>
            <button id="debug-continue">Continue</button>
            <button id="toggle-perf-mode">${this.performanceMode ? 'Detailed Mode' : 'Performance Mode'}</button>
          </div>
        </div>
        <div class="debug-body">
          <div class="debug-section">
            <h4>CPU State</h4>
            <div id="cpu-registers"></div>
          </div>
          <div class="debug-section">
            <h4>Performance</h4>
            <div id="performance-metrics"></div>
          </div>
          <div class="debug-section performance-heavy" ${this.performanceMode ? 'style="display:none"' : ''}>
            <h4>Execution</h4>
            <div id="opcode-history"></div>
          </div>
          <div class="debug-section performance-heavy" ${this.performanceMode ? 'style="display:none"' : ''}>
            <h4>Memory Viewer</h4>
            <input type="text" id="memory-address" placeholder="Address (hex)">
            <button id="view-memory">View</button>
            <div id="memory-display"></div>
          </div>
          <div class="debug-section">
            <h4>Breakpoints</h4>
            <input type="text" id="breakpoint-address" placeholder="Address (hex)">
            <button id="add-breakpoint">Add</button>
            <div id="breakpoint-list"></div>
          </div>
          <div class="debug-section">
            <h4>Log</h4>
            <div id="debug-log"></div>
          </div>
        </div>
      `;
      
      document.body.appendChild(debugPanel);
      this.attachDebugEvents();
      
      // Cache DOM elements for faster access
      this.cacheElements();
    }
  }
  
  // Cache frequently accessed DOM elements
  cacheElements() {
    const elements = [
      'debug-panel', 'cpu-registers', 'performance-metrics', 
      'opcode-history', 'memory-display', 'breakpoint-list', 'debug-log'
    ];
    
    for (const id of elements) {
      this.domElements[id] = document.getElementById(id);
    }
  }

  attachDebugEvents() {
    document.getElementById('debug-pause').addEventListener('click', () => {
      this.pauseExecution();
    });

    document.getElementById('debug-step').addEventListener('click', () => {
      this.stepExecution();
    });

    document.getElementById('debug-continue').addEventListener('click', () => {
      this.continueExecution();
    });

    document.getElementById('add-breakpoint').addEventListener('click', () => {
      const addrInput = document.getElementById('breakpoint-address');
      const addr = parseInt(addrInput.value, 16);
      if (!isNaN(addr)) {
        this.addBreakpoint(addr);
        addrInput.value = '';
        this.updateBreakpointDisplay();
      }
    });

    document.getElementById('view-memory').addEventListener('click', () => {
      const addrInput = document.getElementById('memory-address');
      const addr = parseInt(addrInput.value, 16);
      if (!isNaN(addr)) {
        this.displayMemory(addr);
      }
    });
    
    document.getElementById('toggle-perf-mode').addEventListener('click', () => {
      this.performanceMode = !this.performanceMode;
      this.togglePerformanceMode();
    });
  }
  
  togglePerformanceMode() {
    const perfElements = document.querySelectorAll('.performance-heavy');
    const toggleButton = document.getElementById('toggle-perf-mode');
    
    perfElements.forEach(el => {
      el.style.display = this.performanceMode ? 'none' : 'block';
    });
    
    if (toggleButton) {
      toggleButton.textContent = this.performanceMode ? 'Detailed Mode' : 'Performance Mode';
    }
    
    this.log(`Switched to ${this.performanceMode ? 'performance' : 'detailed'} debug mode`);
  }

  toggle() {
    this.enabled = !this.enabled;
    const debugPanel = this.domElements['debug-panel'];
    if (debugPanel) {
      debugPanel.style.display = this.enabled ? 'block' : 'none';
    }
    
    // Reset UI update timer when toggling
    this.lastUIUpdate = 0;
    
    return this.enabled;
  }

  pauseExecution() {
    this.paused = true;
    this.gameboy.pause(true);
    this.log('Execution paused');
    this.updateUI(true); // Force immediate UI update when pausing
  }

  continueExecution() {
    this.paused = false;
    this.stepMode = false;
    this.gameboy.pause(false);
    this.log('Execution resumed');
  }

  stepExecution() {
    if (this.paused) {
      this.stepMode = true;
      this.gameboy.cpu.executeSingleInstruction();
      this.updateUI(true); // Force update after step
      this.log('Executed single instruction at 0x' + this.gameboy.cpu.r.pc.toString(16));
    }
  }

  addBreakpoint(address) {
    this.breakpoints.add(address);
    this.breakpointMap.set(address, true);
    this.log(`Breakpoint added at 0x${address.toString(16)}`);
  }

  removeBreakpoint(address) {
    this.breakpoints.delete(address);
    this.breakpointMap.delete(address);
    this.log(`Breakpoint removed from 0x${address.toString(16)}`);
  }

  // Optimized breakpoint checking
  checkBreakpoint(address) {
    // Use Map for fast lookup
    if (this.breakpointMap.has(address)) {
      this.pauseExecution();
      this.log(`Breakpoint hit at 0x${address.toString(16)}`);
      return true;
    }
    return false;
  }

  updateBreakpointDisplay() {
    if (!this.enabled) return;
    
    const bpList = this.domElements['breakpoint-list'];
    if (bpList) {
      bpList.innerHTML = '';
      
      // Create document fragment for better performance
      const fragment = document.createDocumentFragment();
      
      for (const bp of this.breakpoints) {
        const bpElement = document.createElement('div');
        bpElement.className = 'breakpoint-item';
        bpElement.textContent = `0x${bp.toString(16)}`;
        
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
          this.removeBreakpoint(bp);
          this.updateBreakpointDisplay();
        });
        
        bpElement.appendChild(removeBtn);
        fragment.appendChild(bpElement);
      }
      
      bpList.appendChild(fragment);
    }
  }

  // Optimized opcode recording using ring buffer
  recordOpcode(address, opcode) {
    if (!this.enabled) return;
    
    // Always count instructions for metrics
    this.metrics.instructionCount++;
    
    // Only track opcode history if not in performance mode
    if (!this.performanceMode) {
      this.opcodeHistory[this.opcodeHistoryIndex] = { address, opcode };
      this.opcodeHistoryIndex = (this.opcodeHistoryIndex + 1) % this.opcodeHistorySize;
    }
  }

  updatePerformanceMetrics() {
    if (!this.enabled) return;
    
    const cpu = this.gameboy.cpu;
    
    // Update metrics based on CPU data
    this.metrics.frameTime.push(cpu.currentFps);
    if (this.metrics.frameTime.length > 10) {
      this.metrics.frameTime.shift();
    }
    
    // Calculate average FPS
    this.metrics.avgFps = this.metrics.frameTime.reduce((a, b) => a + b, 0) / this.metrics.frameTime.length;
  }

  // Optimized memory display
  displayMemory(address) {
    if (!this.enabled || this.performanceMode) return;
    
    address = address & 0xFFF0; // Align to 16-byte boundary
    const memDisplay = this.domElements['memory-display'];
    if (!memDisplay) return;
    
    // Use template strings for faster HTML construction
    let html = '<div class="memory-row memory-header">';
    html += '<span>Address</span>';
    for (let i = 0; i < 16; i++) {
      html += `<span>+${i.toString(16)}</span>`;
    }
    html += '<span>ASCII</span></div>';
    
    // Pre-allocate for ASCII representation
    const asciiChars = new Array(16);
    
    for (let row = 0; row < 8; row++) {
      const rowAddr = address + (row * 16);
      html += `<div class="memory-row"><span>0x${rowAddr.toString(16).padStart(4, '0')}</span>`;
      
      for (let col = 0; col < 16; col++) {
        const byteAddr = rowAddr + col;
        const byteValue = this.gameboy.cpu.memory.rb(byteAddr);
        html += `<span>0x${byteValue.toString(16).padStart(2, '0')}</span>`;
        
        // Add to ASCII representation
        asciiChars[col] = byteValue >= 32 && byteValue <= 126 ? String.fromCharCode(byteValue) : '.';
      }
      
      html += `<span class="memory-ascii">${asciiChars.join('')}</span></div>`;
    }
    
    memDisplay.innerHTML = html;
  }

  // Optimized register display
  updateRegistersDisplay() {
    if (!this.enabled) return;
    
    const regDisplay = this.domElements['cpu-registers'];
    if (!regDisplay) return;
    
    const cpu = this.gameboy.cpu;
    const r = cpu.r;
    
    // Use template strings for better performance
    regDisplay.innerHTML = `
      <div>A: 0x${r.A.toString(16).padStart(2, '0')} | F: 0x${r.F.toString(16).padStart(2, '0')}</div>
      <div>B: 0x${r.B.toString(16).padStart(2, '0')} | C: 0x${r.C.toString(16).padStart(2, '0')}</div>
      <div>D: 0x${r.D.toString(16).padStart(2, '0')} | E: 0x${r.E.toString(16).padStart(2, '0')}</div>
      <div>H: 0x${r.H.toString(16).padStart(2, '0')} | L: 0x${r.L.toString(16).padStart(2, '0')}</div>
      <div>PC: 0x${r.pc.toString(16).padStart(4, '0')} | SP: 0x${r.sp.toString(16).padStart(4, '0')}</div>
      <div>IME: ${cpu.IME ? 'Enabled' : 'Disabled'} | Halted: ${cpu.isHalted ? 'Yes' : 'No'}</div>
    `;
  }

  // Optimized opcode history display
  updateOpcodeHistory() {
    if (!this.enabled || this.performanceMode) return;
    
    const historyDisplay = this.domElements['opcode-history'];
    if (!historyDisplay) return;
    
    let html = '';
    
    // Iterate through the ring buffer in the correct order
    for (let i = 0; i < this.opcodeHistorySize; i++) {
      const index = (this.opcodeHistoryIndex + i) % this.opcodeHistorySize;
      const entry = this.opcodeHistory[index];
      if (entry && entry.address) {
        html += `<div>0x${entry.address.toString(16).padStart(4, '0')}: 0x${entry.opcode.toString(16).padStart(2, '0')}</div>`;
      }
    }
    
    historyDisplay.innerHTML = html;
  }

  log(message) {
    const logEntry = {
      time: new Date(),
      message
    };
    
    // Use unshift for better performance than push+shift
    this.logHistory.unshift(logEntry);
    if (this.logHistory.length > this.maxLogHistory) {
      this.logHistory.length = this.maxLogHistory;
    }
    
    if (this.enabled) {
      this.updateLogDisplay();
    }
    
    // Only log to console in development/debugging
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEBUG] ${message}`);
    }
  }

  updateLogDisplay() {
    if (!this.enabled) return;
    
    const logDisplay = this.domElements['debug-log'];
    if (!logDisplay) return;
    
    // Generate log content
    let html = '';
    
    // Only show the most recent entries in the UI
    const displayCount = Math.min(20, this.logHistory.length);
    
    for (let i = 0; i < displayCount; i++) {
      const entry = this.logHistory[i];
      const timeString = entry.time.toTimeString().split(' ')[0];
      html += `<div>[${timeString}] ${entry.message}</div>`;
    }
    
    logDisplay.innerHTML = html;
    
    // Auto-scroll to top (since we're adding at the top)
    logDisplay.scrollTop = 0;
  }

  updateUI(force = false) {
    if (!this.enabled) return;
    
    const now = performance.now();
    
    // Throttle UI updates to avoid performance hit
    if (!force && now - this.lastUIUpdate < this.throttleInterval) {
      // If update already scheduled, don't schedule another one
      if (!this.uiUpdateScheduled) {
        this.uiUpdateScheduled = true;
        requestAnimationFrame(() => {
          this.updateUI();
          this.uiUpdateScheduled = false;
        });
      }
      return;
    }
    
    this.lastUIUpdate = now;
    
    // Update performance display first (most important)
    const perfElement = this.domElements['performance-metrics'];
    if (perfElement) {
      const cpu = this.gameboy.cpu;
      perfElement.textContent = `
        FPS: ${cpu.currentFps.toFixed(2)} | 
        Avg: ${this.metrics.avgFps.toFixed(2)} | 
        Instructions: ${this.metrics.instructionCount} |
        Mode: ${this.performanceMode ? 'Fast' : 'Detailed'}
      `;
    }
    
    // Update CPU registers
    this.updateRegistersDisplay();
    
    // Heavy updates only if not in performance mode
    if (!this.performanceMode) {
      this.updateOpcodeHistory();
      // Only update memory display when explicitly requested or after stepping
      if (force) {
        this.displayMemory(this.gameboy.cpu.r.pc);
      }
    }
    
    // Update log display
    this.updateLogDisplay();
  }

  handleError(error, context) {
    this.log(`ERROR: ${error.message} in ${context}`);
    this.pauseExecution();
    this.updateUI(true); // Force immediate update on errors
    
    // Only show full error details when not in performance mode
    if (!this.performanceMode) {
      // Show error in UI
      const errorDetails = document.createElement('div');
      errorDetails.className = 'error-details';
      errorDetails.innerHTML = `
        <h4>Error Details</h4>
        <div>Type: ${error.name}</div>
        <div>Message: ${error.message}</div>
        <div>Context: ${context}</div>
        <div>Stack: ${error.stack}</div>
      `;
      
      // Add to debug panel
      const debugPanel = this.domElements['debug-panel'];
      if (debugPanel) {
        // Remove any existing error details
        const existingError = debugPanel.querySelector('.error-details');
        if (existingError) {
          debugPanel.removeChild(existingError);
        }
        
        debugPanel.appendChild(errorDetails);
      }
    }
    
    console.error('[DEBUG] Error:', error);
  }
}