import { Keyboard } from 'grammy'

export const mainKeyboard = new Keyboard()
  .text('🌐 Bring me to Site')
  .text('📊 Monthly Report')
  .row()
  .text('📝 Recents')
  .text('📦 Spaces')
  .row()
  .text('💸 IOUs')
  .text('❓ Help')
  .resized()
  .persistent()
