/* SPDX-License-Identifier: MIT */

.section .text.start, "ax", @progbits
.globl _start
.type _start, @function
_start:
  li a0, 1
  la t0, counter
  sw a0, 0(t0)
1:
  j 1b
.size _start, . - _start

.section .data.counter, "aw", @progbits
.globl counter
.type counter, @object
.size counter, 4
counter:
  .word 0
