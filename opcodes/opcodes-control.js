// opcodes-control.js - Control flow opcodes (0xC0-0xFF)
import { cpuOps } from '../cpu-operations.js';

export const controlOpcodes = {
  0xC0: function(p){cpuOps.RETcc(p, 'NZ');},
  0xC1: function(p){cpuOps.POPrr(p, 'B', 'C');},
  0xC2: function(p){cpuOps.JPccnn(p, 'NZ');},
  0xC3: function(p){cpuOps.JPnn(p);},
  0xC4: function(p){cpuOps.CALLccnn(p, 'NZ');},
  0xC5: function(p){cpuOps.PUSHrr(p, 'B', 'C');},
  0xC6: function(p){cpuOps.ADDrn(p, 'A');},
  0xC7: function(p){cpuOps.RSTn(p, 0x00);},
  0xC8: function(p){cpuOps.RETcc(p, 'Z');},
  0xC9: function(p){cpuOps.RET(p);},
  0xCA: function(p){cpuOps.JPccnn(p, 'Z');},
  0xCB: function(p){cpuOps.CB(p);},
  0xCC: function(p){cpuOps.CALLccnn(p, 'Z');},
  0xCD: function(p){cpuOps.CALLnn(p);},
  0xCE: function(p){cpuOps.ADCrn(p, 'A');},
  0xCF: function(p){cpuOps.RSTn(p, 0x08);},

  0xD0: function(p){cpuOps.RETcc(p, 'NC');},
  0xD1: function(p){cpuOps.POPrr(p, 'D', 'E');},
  0xD2: function(p){cpuOps.JPccnn(p, 'NC');},
  //0xD3 empty
  0xD4: function(p){cpuOps.CALLccnn(p, 'NC');},
  0xD5: function(p){cpuOps.PUSHrr(p, 'D', 'E');},
  0xD6: function(p){cpuOps.SUBn(p);},
  0xD7: function(p){cpuOps.RSTn(p, 0x10);},
  0xD8: function(p){cpuOps.RETcc(p, 'C');},
  0xD9: function(p){cpuOps.RETI(p);},
  0xDA: function(p){cpuOps.JPccnn(p, 'C');},
  //0xDB empty
  0xDC: function(p){cpuOps.CALLccnn(p, 'C');},
  //0xDD empty
  0xDE: function(p){cpuOps.SBCn(p);},
  0xDF: function(p){cpuOps.RSTn(p, 0x18);},

  0xE0: function(p){cpuOps.LDHnar(p, 'A');},
  0xE1: function(p){cpuOps.POPrr(p, 'H', 'L');},
  0xE2: function(p){cpuOps.LDrar(p, 'C', 'A');},
  //0xE3 empty
  //0xE4 empty
  0xE5: function(p){cpuOps.PUSHrr(p, 'H', 'L');},
  0xE6: function(p){cpuOps.ANDn(p);},
  0xE7: function(p){cpuOps.RSTn(p, 0x20);},
  0xE8: function(p){cpuOps.ADDspn(p);},
  0xE9: function(p){cpuOps.JPrr(p, 'H', 'L');},
  0xEA: function(p){cpuOps.LDnnar(p, 'A');},
  //0xEB empty
  //0xEC empty
  //0xED empty
  0xEE: function(p){cpuOps.XORn(p);},
  0xEF: function(p){cpuOps.RSTn(p, 0x28);},

  0xF0: function(p){cpuOps.LDHrna(p, 'A');},
  0xF1: function(p){cpuOps.POPrr(p, 'A', 'F');},
  0xF2: function(p){cpuOps.LDrra(p, 'A', 'C');},
  0xF3: function(p){cpuOps.DI(p);},
  //0xF4 empty
  0xF5: function(p){cpuOps.PUSHrr(p, 'A', 'F');},
  0xF6: function(p){cpuOps.ORn(p);},
  0xF7: function(p){cpuOps.RSTn(p, 0x30);},
  0xF8: function(p){cpuOps.LDrrspn(p, 'H', 'L');},
  0xF9: function(p){cpuOps.LDsprr(p, 'H', 'L');},
  0xFA: function(p){cpuOps.LDrnna(p, 'A');},
  0xFB: function(p){cpuOps.EI(p);},
  //0xFC empty
  //0xFD empty
  0xFE: function(p){cpuOps.CPn(p);},
  0xFF: function(p){cpuOps.RSTn(p, 0x38);}
};

