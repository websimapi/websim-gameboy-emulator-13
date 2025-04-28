// timer.js - Timer implementation with DIV, TIMA, TMA, TAC registers

// Timer class for managing the Gameboy's timer registers
export class Timer {
    constructor(cpu, memory) {
        this.cpu = cpu;
        this.memory = memory;

        // Timer registers
        this.DIV = 0xFF04;  // Divider Register
        this.TIMA = 0xFF05; // Timer Counter
        this.TMA = 0xFF06;  // Timer Modulo
        this.TAC = 0xFF07;  // Timer Control

        this.mainTime = 0;
        this.divTime = 0;
    }

    update(clockElapsed) {
        this.updateDiv(clockElapsed);
        this.updateTimer(clockElapsed);
    }

    // Update the TIMA register
    updateTimer(clockElapsed) {
        // Return if timer is disabled
        if (!(this.memory.rb(this.TAC) & 0x4)) {
            return;
        }
        
        this.mainTime += clockElapsed;

        // Determine timer frequency based on TAC bits 0-1
        let threshold = 64;
        switch (this.memory.rb(this.TAC) & 3) {
            case 0: threshold = 64; break; // 4KHz
            case 1: threshold = 1;  break; // 256KHz
            case 2: threshold = 4;  break; // 64KHz
            case 3: threshold = 16; break; // 16KHz
        }
        threshold *= 16;

        // Increment TIMA when threshold is reached
        while (this.mainTime >= threshold) {
            this.mainTime -= threshold;

            // Increment TIMA and check for overflow
            this.memory.wb(this.TIMA, this.memory.rb(this.TIMA) + 1);
            if (this.memory.rb(this.TIMA) > 0xFF) {
                // On overflow, reset to value in TMA and trigger timer interrupt
                this.memory.wb(this.TIMA, this.memory.rb(this.TMA));
                this.cpu.requestInterrupt(2); // TIMER interrupt
            }
        }
    }

    // Update the DIV register internal clock
    // Increment it if the clock threshold is elapsed and
    // reset it if its value overflows
    updateDiv(clockElapsed) {
        const divThreshold = 256; // DIV is 16KHz
        this.divTime += clockElapsed;
        if (this.divTime > divThreshold) {
            this.divTime -= divThreshold;
            const div = this.memory.rb(this.DIV) + 1;
            this.memory.wb(this.DIV, div & 0xFF);
        }
    }

    // Reset the DIV register - called when written to
    resetDiv() {
        this.divTime = 0;
        this.memory[this.DIV] = 0; // direct write to avoid looping
    }
}