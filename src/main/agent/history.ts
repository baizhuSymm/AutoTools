import type { WireMessage } from './contracts'
export function boundedHistory(turns: WireMessage[][], current: string): WireMessage[] {
  const user: WireMessage = { role: 'user', content: current }
  if (Buffer.byteLength(JSON.stringify([user])) > 60000) throw new Error('消息过长，请缩短后发送')
  const retained = turns.slice(-20).map((turn) => structuredClone(turn))
  while (retained.length && Buffer.byteLength(JSON.stringify([...retained.flat(), user])) > 60000)
    retained.shift()
  return [...retained.flat(), user]
}
