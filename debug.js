// debug.js - Comprehensive debugging tools for GameboyJS

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
    this.lastOpcodes = new Array(10).fill({address: 0, opcode: 0});
    this.createDebugUI();
  }

  createDebugUI() {
    // Create debug panel if it doesn't exist
    if (!document.getElementById('debug-panel')) {
      const debugPanel = document.createElement('div');
      debugPanel.id = 'debug-panel';
      debugPanel.className = 'debug-panel';
      debugPanel.style.display = this.enabled ? 'block' : 'none';
      
      // Add content to debug panel
      debugPanel.innerHTML = `
        <div class="debug-header">
          <h3>GameboyJS Debugger</h3>
          <div class="debug-controls">
            <button id="debug-pause">Pause</button>
            <button id="debug-step">Step</button>
            <button id="debug-continue">Continue</button>
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
          <div class="debug-section">
            <h4>Execution</h4>
            <div id="opcode-history"></div>
          </div>
          <div class="debug-section">
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
    }

    // Add CSS for debug panel
    if (!document.getElementById('debug-styles')) {
      const styleSheet = document.createElement('style');
      styleSheet.id = 'debug-styles';
      styleSheet.textContent = `
        .debug-panel {
          position: fixed;
          top: 0;
          right: 0;
          width: 400px;
          height: 100%;
          background-color: rgba(34, 34, 34, 0.95);
          color: #eee;
          overflow-y: auto;
          font-family: monospace;
          z-index: 1000;
          padding: 10px;
          box-shadow: -2px 0 10px rgba(0, 0, 0, 0.5);
        }
        
        .debug-header {
          border-bottom: 1px solid #555;
          padding-bottom: 10px;
          margin-bottom: 10px;
        }
        
        .debug-controls {
          display: flex;
          gap: 5px;
          margin-top: 10px;
        }
        
        .debug-body {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        
        .debug-section {
          border: 1px solid #444;
          border-radius: 5px;
          padding: 10px;
          background-color: #333;
        }
        
        .debug-section h4 {
          margin-top: 0;
          border-bottom: 1px solid #555;
          padding-bottom: 5px;
          margin-bottom: 10px;
        }
        
        .memory-row {
          display: flex;
          gap: 5px;
          padding: 2px 0;
        }
        
        .memory-header {
          font-weight: bold;
          border-bottom: 1px solid #555;
          padding-bottom: 5px;
          margin-bottom: 5px;
        }
        
        .memory-ascii {
          margin-left: 10px;
          font-family: monospace;
        }
        
        #cpu-registers {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 5px;
        }
        
        #opcode-history {
          max-height: 150px;
          overflow-y: auto;
        }
        
        #debug-log {
          max-height: 200px;
          overflow-y: auto;
          font-size: 12px;
        }
        
        .breakpoint-item {
          display: flex;
          justify-content: space-between;
          margin: 5px 0;
        }
        
        .debug-panel input[type="text"] {
          background-color: #444;
          border: 1px solid #555;
          color: #fff;
          padding: 5px;
          margin-right: 5px;
        }
        
        .debug-panel button {
          background-color: #555;
          border: none;
          color: #fff;
          padding: 5px 10px;
          cursor: pointer;
          border-radius: 3px;
        }
        
        .debug-panel button:hover {
          background-color: #666;
        }
        
        .error-details {
          background-color: #500;
          border: 1px solid #f00;
          border-radius: 5px;
          padding: 10px;
          margin-top: 20px;
        }
      `;
      document.head.appendChild(styleSheet);
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
  }

  toggle() {
    this.enabled = !this.enabled;
    const debugPanel = document.getElementById('debug-panel');
    if (debugPanel) {
      debugPanel.style.display = this.enabled ? 'block' : 'none';
    }
    return this.enabled;
  }

  pauseExecution() {
    this.paused = true;
    this.gameboy.pause(true);
    this.log('Execution paused');
    this.updateUI();
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
      this.updateUI();
      this.log('Executed single instruction at 0x' + this.gameboy.cpu.r.pc.toString(16));
    }
  }

  addBreakpoint(address) {
    this.breakpoints.add(address);
    this.log(`Breakpoint added at 0x${address.toString(16)}`);
  }

  removeBreakpoint(address) {
    this.breakpoints.delete(address);
    this.log(`Breakpoint removed from 0x${address.toString(16)}`);
  }

  checkBreakpoint(address) {
    if (this.breakpoints.has(address)) {
      this.pauseExecution();
      this.log(`Breakpoint hit at 0x${address.toString(16)}`);
      return true;
    }
    return false;
  }

  updateBreakpointDisplay() {
    const bpList = document.getElementById('breakpoint-list');
    if (bpList) {
      bpList.innerHTML = '';
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
        bpList.appendChild(bpElement);
      }
    }
  }

  recordOpcode(address, opcode) {
    this.lastOpcodes.shift();
    this.lastOpcodes.push({ address, opcode });
    this.metrics.instructionCount++;
  }

  updatePerformanceMetrics(frameTime) {
    const now = performance.now();
    const elapsed = now - this.metrics.lastFrameTime;
    this.metrics.lastFrameTime = now;
    
    this.metrics.frameTime.push(elapsed);
    if (this.metrics.frameTime.length > 60) {
      this.metrics.frameTime.shift();
    }
    
    // Calculate average FPS from the last 60 frames
    const avgFrameTime = this.metrics.frameTime.reduce((a, b) => a + b, 0) / this.metrics.frameTime.length;
    this.metrics.avgFps = 1000 / avgFrameTime;
    
    // Update UI
    const perfElement = document.getElementById('performance-metrics');
    if (perfElement) {
      perfElement.textContent = `FPS: ${this.metrics.avgFps.toFixed(2)} | Instructions: ${this.metrics.instructionCount}`;
    }
  }

  displayMemory(address) {
    address = address & 0xFFF0; // Align to 16-byte boundary
    const memDisplay = document.getElementById('memory-display');
    if (memDisplay) {
      let html = '<div class="memory-row memory-header">';
      html += '<span>Address</span>';
      for (let i = 0; i < 16; i++) {
        html += `<span>+${i.toString(16)}</span>`;
      }
      html += '<span>ASCII</span></div>';
      
      for (let row = 0; row < 8; row++) {
        const rowAddr = address + (row * 16);
        html += `<div class="memory-row"><span>0x${rowAddr.toString(16).padStart(4, '0')}</span>`;
        
        let asciiRow = '';
        for (let col = 0; col < 16; col++) {
          const byteAddr = rowAddr + col;
          const byteValue = this.gameboy.cpu.memory.rb(byteAddr);
          html += `<span>0x${byteValue.toString(16).padStart(2, '0')}</span>`;
          
          // Add to ASCII representation
          asciiRow += byteValue >= 32 && byteValue <= 126 ? String.fromCharCode(byteValue) : '.';
        }
        
        html += `<span class="memory-ascii">${asciiRow}</span></div>`;
      }
      
      memDisplay.innerHTML = html;
    }
  }

  updateRegistersDisplay() {
    const regDisplay = document.getElementById('cpu-registers');
    if (regDisplay) {
      const cpu = this.gameboy.cpu;
      regDisplay.innerHTML = `
        <div>A: 0x${cpu.r.A.toString(16).padStart(2, '0')} | F: 0x${cpu.r.F.toString(16).padStart(2, '0')}</div>
        <div>B: 0x${cpu.r.B.toString(16).padStart(2, '0')} | C: 0x${cpu.r.C.toString(16).padStart(2, '0')}</div>
        <div>D: 0x${cpu.r.D.toString(16).padStart(2, '0')} | E: 0x${cpu.r.E.toString(16).padStart(2, '0')}</div>
        <div>H: 0x${cpu.r.H.toString(16).padStart(2, '0')} | L: 0x${cpu.r.L.toString(16).padStart(2, '0')}</div>
        <div>PC: 0x${cpu.r.pc.toString(16).padStart(4, '0')} | SP: 0x${cpu.r.sp.toString(16).padStart(4, '0')}</div>
        <div>IME: ${cpu.IME ? 'Enabled' : 'Disabled'} | Halted: ${cpu.isHalted ? 'Yes' : 'No'}</div>
      `;
    }
  }

  updateOpcodeHistory() {
    const historyDisplay = document.getElementById('opcode-history');
    if (historyDisplay) {
      let html = '';
      for (const entry of this.lastOpcodes) {
        if (entry.address) {
          html += `<div>0x${entry.address.toString(16).padStart(4, '0')}: 0x${entry.opcode.toString(16).padStart(2, '0')}</div>`;
        }
      }
      historyDisplay.innerHTML = html;
    }
  }

  log(message) {
    const logEntry = {
      time: new Date(),
      message
    };
    
    this.logHistory.push(logEntry);
    if (this.logHistory.length > this.maxLogHistory) {
      this.logHistory.shift();
    }
    
    this.updateLogDisplay();
    console.log(`[DEBUG] ${message}`);
  }

  updateLogDisplay() {
    const logDisplay = document.getElementById('debug-log');
    if (logDisplay) {
      let html = '';
      for (const entry of this.logHistory) {
        const timeString = entry.time.toTimeString().split(' ')[0];
        html += `<div>[${timeString}] ${entry.message}</div>`;
      }
      logDisplay.innerHTML = html;
    }
  }

  updateUI() {
    if (this.enabled) {
      this.updateRegistersDisplay();
      this.updateOpcodeHistory();
      this.displayMemory(this.gameboy.cpu.r.pc);
    }
  }

  handleError(error, context) {
    this.log(`ERROR: ${error.message} in ${context}`);
    this.pauseExecution();
    this.updateUI();
    
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
    const debugPanel = document.getElementById('debug-panel');
    if (debugPanel) {
      debugPanel.appendChild(errorDetails);
    }
    
    console.error('[DEBUG] Error:', error);
  }
}