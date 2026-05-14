import { Keyboard } from 'grammy'

export const mainKeyboard = new Keyboard()
  .text('📊 Dashboard')
  .text('📝 Recent')
  .text('❓ Help')
  .resized()
  .persistent()
