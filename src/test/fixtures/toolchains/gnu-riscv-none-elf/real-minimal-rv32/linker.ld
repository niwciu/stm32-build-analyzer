OUTPUT_ARCH(riscv)
ENTRY(_start)

MEMORY
{
  FLASH (rx)  : ORIGIN = 0x20000000, LENGTH = 64K
  RAM   (rwx) : ORIGIN = 0x80000000, LENGTH = 16K
}

SECTIONS
{
  .text :
  {
    *(.text*)
  } > FLASH

  .data :
  {
    *(.data*)
  } > RAM AT> FLASH

  .bss (NOLOAD) :
  {
    *(.bss*)
    *(COMMON)
  } > RAM
}
