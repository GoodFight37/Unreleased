import { loadSongFootage, footageBrowserOnly } from '../footageIndex'
import { useStore } from '../../store/useStore'
import type { TermCommand } from './types'

export const FOOTAGE_COMMANDS: TermCommand[] = [{
  name: 'footage', group: 'Content', usage: 'footage <song title> [--approximate]',
  description: 'Find Footage, Snippets and Studio Sessions by song title',
  covers: ['footageIndex.loadSongFootage', 'footageIndex.matchFootage', 'footageIndex.footageBrowserOnly'],
  run: async (args, ctx) => {
    const approximate = /(?:^|\s)--approximate(?:\s|$)/.test(args)
    const title = args.replace(/(?:^|\s)--approximate(?=\s|$)/g, ' ').trim()
    if (!title) throw new Error('usage: footage <song title> [--approximate]')
    const channel = useStore.getState().activeChannel ?? ''
    const matches = await loadSongFootage(title, channel, approximate)
    if (!matches) throw new Error('File index unavailable; try again shortly')
    ctx.print(matches.length ? matches.map(m => `${m.level === 'exact' ? 'Exact' : `${m.confidence}% ${m.level}`}  ${m.entry.path}${footageBrowserOnly(m.entry) ? ' · browser only' : ''}`).join('\n') : 'No matching footage', matches.length ? 'plain' : 'dim')
  },
}]
