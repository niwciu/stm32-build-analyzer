/* SPDX-License-Identifier: MIT */

.syntax unified
.thumb
.file 1 "startup.S"

.section .text.start, "ax", %progbits
.globl _start
.type _start, %function
_start:
  .loc 1 11 0
  movs r0, #1
  ldr r1, =counter
  str r0, [r1]
1:
  b 1b
.size _start, . - _start

.section .data.counter, "aw", %progbits
.globl counter
.type counter, %object
.size counter, 4
counter:
  .word 0
