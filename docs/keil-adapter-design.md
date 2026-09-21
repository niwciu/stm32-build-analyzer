# Keil/Arm Compiler adapter design

## Decision

The adapter parses the self-contained text report produced by `armlink`. It
does not execute AXF files or require `fromelf`, `armlink`, or another licensed
Arm tool. This keeps analysis available on machines that only have archived
build outputs and avoids making proprietary software a runtime dependency.

Execution-region declarations provide origins and maximum capacities. Section
rows provide runtime placement, size, and data class. When an Arm Compiler 6
row contains an explicit load address, initialized RAM data is also attributed
to its load region. The optional image symbol table supplies symbol addresses
and sizes.

## Verified scope

- Arm Compiler 5.06 update 5 is covered by a real compact armlink MAP fixture
  from Mbed OS, redistributed under Apache-2.0.
- Arm Compiler 6.21's explicit `Exec Addr`/`Load Addr` layout is covered by a
  documented synthetic fixture and remains experimental pending a
  redistributable real fixture.
- Arm Compiler 4, Arm Compiler 7 or later, incomplete reports without execution
  regions, and non-Arm Keil linker formats are rejected.

The real compact fixture deliberately omits the RAM execution-region heading.
Rows outside a declared region are ignored with a partial-analysis warning;
the parser never invents a capacity from section addresses.
