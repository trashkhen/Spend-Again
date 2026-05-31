import { Keyboard } from 'grammy'

export const mainKeyboard = new Keyboard()
  .text('🌐 Bring me to Site')
  .text('📊 Monthly Report')
  .row()
  .text('📝 Recents')
  .text('📦 Spaces')
  .text('❓ Help')
  .resized()
  .persistent()
