import { bot } from './bot.js'
import { helpHandler } from './handlers/help.js'
import { startHandler } from './handlers/start.js'

bot.command('start', startHandler)
bot.command('help', helpHandler)

await bot.start()
