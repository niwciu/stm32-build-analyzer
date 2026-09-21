/* SPDX-License-Identifier: MIT */

volatile unsigned int counter = 0;

void _start(void) {
  counter = 1;
  for (;;) {
    __asm__ volatile ("nop");
  }
}
