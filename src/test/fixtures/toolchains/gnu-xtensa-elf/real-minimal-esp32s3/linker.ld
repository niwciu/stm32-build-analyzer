/* SPDX-License-Identifier: MIT */

OUTPUT_ARCH(xtensa)
ENTRY(_start)

MEMORY
{
  iram0_0_seg (rx)  : ORIGIN = 0x40378000, LENGTH = 0x54700
  dram0_0_seg (rw)  : ORIGIN = 0x3fc88000, LENGTH = 0x54700
}

SECTIONS
{
  .iram0.text :
  {
    *(.literal*)
    *(.text*)
  } > iram0_0_seg

  .dram0.data :
  {
    *(.data*)
  } > dram0_0_seg

  .dram0.bss (NOLOAD) :
  {
    *(.bss*)
    *(COMMON)
  } > dram0_0_seg
}
